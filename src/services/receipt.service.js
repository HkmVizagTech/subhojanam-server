const puppeteer = require("puppeteer");
const ejs = require("ejs");
const fs = require("fs");
const path = require("path");
const { settingsModel } = require("../models/settings.model");
const { donationModle } = require("../models/donation.model");
const numberToWords = require("number-to-words");

const generateReceipt = async (donation, apiResponse = null) => {
  try {
    console.log("Receipt generation started for donation:", donation._id);

    let settings = await settingsModel.findOne();
    console.log(
      "Settings fetched, current receipt number:",
      settings?.receiptSettings?.currentReceiptNumber,
    );

    if (!settings) {
      console.log("No settings found, creating default...");
      settings = await settingsModel.create({
        receiptSettings: {
          startNumber: 5000,
          currentReceiptNumber: 5000,
        },
      });
    }

    // Define apiResp FIRST
    let apiResp = apiResponse;
    if (!apiResp) {
      if (donation.externalApiResponse) apiResp = donation.externalApiResponse;
      else {
        try {
          const fresh = await donationModle
            .findById(donation._id)
            .select("externalApiResponse")
            .lean();
          if (fresh && fresh.externalApiResponse)
            apiResp = fresh.externalApiResponse;
        } catch (e) {
          console.warn(
            "Could not load externalApiResponse from DB:",
            e.message || e,
          );
        }
      }
    }

    // Determine receipt number
    let receiptNumber;
    let formattedReceiptNumber;

    if (apiResp?.ReceiptNumber) {
      // Use API receipt number (already in correct format)
      receiptNumber = apiResp.ReceiptNumber;
      formattedReceiptNumber = receiptNumber;
      console.log("✅ Using API receipt number:", receiptNumber);
      // DO NOT increment settings counter for API receipts
    } else {
      // Use local receipt number (fallback)
      const localNumber =
        settings.receiptSettings.currentReceiptNumber ||
        settings.receiptSettings.startNumber;
      receiptNumber = localNumber;
      formattedReceiptNumber = `HKMI|${new Date().getFullYear()}|D/VSP|${String(localNumber).padStart(5, "0")}`;
      console.log("⚠️ Using local receipt number:", formattedReceiptNumber);

      // Only increment local counter when using local numbers
      await settingsModel.findByIdAndUpdate(settings._id, {
        $set: { "receiptSettings.currentReceiptNumber": localNumber + 1 },
      });
    }

    // Save receipt number to donation (always as string)
    await donationModle.findByIdAndUpdate(donation._id, {
      receiptNumber: formattedReceiptNumber,
      receiptGeneratedAt: new Date(),
    });

    console.log(
      "Receipt Service: using receiptNumber:",
      formattedReceiptNumber,
    );

    const receiptDate = new Date().toLocaleDateString("en-GB");
    const address = `${donation.address || ""}, ${donation.city || ""}, ${donation.state || ""} - ${donation.pincode || ""}`;

    const logoBase64 = fs.readFileSync(
      path.join(__dirname, "../public/hkmi-logo.jpg"),
      "base64",
    );

    const stampBase64 = fs.readFileSync(
      path.join(__dirname, "../public/hkmi-stamp-removebg-preview.png"),
      "base64",
    );

    const amountWords =
      numberToWords.toWords(donation.amount).toUpperCase() + " RUPEES ONLY";

    const templatePath = path.join(__dirname, "../templates/receipt.ejs");
    const html = await ejs.renderFile(templatePath, {
      receiptNumber: formattedReceiptNumber,
      receiptDate,
      donorName: donation.name || "Donor",
      address: address || "N/A",
      patronId: "",
      sevakName: "",
      donorNumber: apiResp?.DonorNumber || "",
      mobile: donation.mobile || "",
      certificate: donation.certificate === true ? "YES" : "NO",
      email: donation.email || "",
      pan: donation.panNumber || "",
      amount: donation.amount || 0,
      amountWords: amountWords,
      paymentRef: donation.razorpayPaymentId || "",
      paymentDate: receiptDate,
      logoBase64,
      stampBase64,
      externalApiResponse: apiResp,
    });

    // Launch puppeteer
    const execPath =
      process.env.CHROME_PATH ||
      (process.platform === "darwin"
        ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
        : undefined);

    const launchOptions = {
      headless: "new",
      executablePath:
        process.env.PUPPETEER_EXECUTABLE_PATH || "/usr/bin/chromium",
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage", // needed for Cloud Run
        "--disable-gpu",
        "--disable-software-rasterizer",
        "--disable-extensions",
        "--disable-crash-reporter", // stops crashpad dying
        "--crash-dumps-dir=/tmp", // gives crashpad a valid path
      ],
      ignoreHTTPSErrors: true,
    };
    if (execPath) launchOptions.executablePath = execPath;

    const browser = await puppeteer.launch(launchOptions);
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "load" });

    const receiptsDir = path.join(__dirname, "../../receipts");
    if (!fs.existsSync(receiptsDir)) {
      fs.mkdirSync(receiptsDir);
    }

    const safeName = donation.name.replace(/\s+/g, "_");
    const fileName = `Donation_Receipt_${safeName}.pdf`;
    const filePath = path.join(receiptsDir, fileName);

    console.log("Generating PDF at path:", filePath);
    await page.pdf({
      path: filePath,
      format: "A4",
      printBackground: true,
      margin: {
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
      },
    });

    console.log("Closing browser...");
    await browser.close();

    console.log("Receipt PDF generated successfully!");
    return filePath;
  } catch (error) {
    console.error("Error in generateReceipt:", error);
    throw error;
  }
};

module.exports = { generateReceipt };
