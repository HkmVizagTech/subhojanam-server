const puppeteer = require("puppeteer");
const ejs = require("ejs");
const fs = require("fs");
const path = require("path");
const { settingsModel } = require("../models/settings.model");
const { donationModle } = require("../models/donation.model");
const numberToWords = require("number-to-words");

let sharedBrowser = null;

const getBrowser = async () => {
  if (sharedBrowser) {
    try {
      // Check if still alive
      await sharedBrowser.version();
      return sharedBrowser;
    } catch {
      sharedBrowser = null;
    }
  }
  sharedBrowser = await puppeteer.launch({
    headless: true,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || "/usr/bin/chromium",
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--disable-software-rasterizer",
      "--disable-extensions",
      "--disable-crash-reporter",
      "--crash-dumps-dir=/tmp",
    ],
  });
  return sharedBrowser;
};

const generateReceipt = async (donation, apiResponse = null) => {
  try {
    console.log("Receipt generation started for donation:", donation._id);

    let settings = await settingsModel.findOne();
    if (!settings) {
      settings = await settingsModel.create({
        receiptSettings: { startNumber: 5000, currentReceiptNumber: 5000 },
      });
    }

    let apiResp = apiResponse;
    if (!apiResp) {
      if (donation.externalApiResponse) {
        apiResp = donation.externalApiResponse;
      } else {
        try {
          const fresh = await donationModle
            .findById(donation._id)
            .select("externalApiResponse")
            .lean();
          if (fresh?.externalApiResponse) apiResp = fresh.externalApiResponse;
        } catch (e) {
          console.warn("Could not load externalApiResponse:", e.message || e);
        }
      }
    }

    let formattedReceiptNumber;
    if (apiResp?.ReceiptNumber) {
      formattedReceiptNumber = apiResp.ReceiptNumber;
      console.log("✅ Using API receipt number:", formattedReceiptNumber);
    } else {
      const localNumber =
        settings.receiptSettings.currentReceiptNumber ||
        settings.receiptSettings.startNumber;
      formattedReceiptNumber = `HKMI|${new Date().getFullYear()}|D/VSP|${String(localNumber).padStart(5, "0")}`;
      console.log("⚠️ Using local receipt number:", formattedReceiptNumber);
      await settingsModel.findByIdAndUpdate(settings._id, {
        $set: { "receiptSettings.currentReceiptNumber": localNumber + 1 },
      });
    }

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
      sevakName: donation.sevakName || "",
      donorNumber: apiResp?.DonorNumber || "",
      mobile: donation.mobile || "",
      certificate: donation.certificate === true ? "YES" : "NO",
      email: donation.email || "",
      pan: donation.panNumber || "",
      amount: donation.amount || 0,
      amountWords,
      paymentRef: donation.razorpayPaymentId || donation.offlineRefNo || "",
      paymentDate: receiptDate,
      enrolledBy: apiResp?.EnrolledBy || apiResp?.EnrolledByName || "",
      cdc: apiResp?.CDC || apiResp?.CDCName || "",
      logoBase64,
      stampBase64,
      externalApiResponse: apiResp,
    });

    const receiptsDir = process.env.RECEIPTS_DIR || "/tmp/receipts";
    if (!fs.existsSync(receiptsDir)) {
      fs.mkdirSync(receiptsDir, { recursive: true });
    }

    const safeName = donation.name.replace(/[^a-zA-Z0-9]/g, "_").replace(/_+/g, "_").slice(0, 50);
    const filePath = path.join(receiptsDir, `Donation_Receipt_${safeName}.pdf`);

    const browser = await getBrowser();
    console.log("✅ Browser ready");

    const page = await browser.newPage();
    console.log("✅ New page created");
    try {
      await page.setContent(html, { waitUntil: "networkidle0", timeout: 30000 });
      console.log("✅ Content set");

      await page.pdf({
        path: filePath,
        format: "A4",
        printBackground: true,
        margin: { top: 0, right: 0, bottom: 0, left: 0 },
      });
      console.log("✅ PDF written to disk");
    } finally {
      await page.close();
      console.log("✅ Page closed");
    }

    // ✅ Only saved AFTER pdf is confirmed written
    await donationModle.findByIdAndUpdate(donation._id, {
      receiptNumber: formattedReceiptNumber,
      receiptGeneratedAt: new Date(),
    });

    console.log("Receipt PDF generated successfully!");
    return filePath;
  } catch (error) {
    console.error("Error in generateReceipt:", error);
    throw error;
  }
};

module.exports = { generateReceipt };
