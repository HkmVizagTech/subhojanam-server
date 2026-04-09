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
    console.log("Settings fetched, current receipt number:", settings?.receiptSettings?.currentReceiptNumber);
    
    if (!settings) {
      console.log("No settings found, creating default...");
      settings = await settingsModel.create({
        receiptSettings: {
          startNumber: 5000,
          currentReceiptNumber: 5000
        }
      });
    }

  const receiptNumber = settings.receiptSettings.currentReceiptNumber || settings.receiptSettings.startNumber;
  
  await settingsModel.findByIdAndUpdate(settings._id, {
    $set: { 'receiptSettings.currentReceiptNumber': receiptNumber + 1 }
  });

  await donationModle.findByIdAndUpdate(donation._id, {
    receiptNumber: receiptNumber,
    receiptGeneratedAt: new Date()
  });

  const templatePath = path.join(__dirname, "../templates/receipt.ejs");

  // If caller didn't pass apiResponse, try to read any stored externalApiResponse on the donation
  let apiResp = apiResponse;
  if (!apiResp) {
    if (donation.externalApiResponse) apiResp = donation.externalApiResponse;
    else {
      try {
        const fresh = await donationModle.findById(donation._id).select('externalApiResponse').lean();
        if (fresh && fresh.externalApiResponse) apiResp = fresh.externalApiResponse;
      } catch (e) {
        console.warn('Could not load externalApiResponse from DB:', e.message || e);
      }
    }
  }

  // Prefer external API receipt number when provided (useful when external system issues the official receipt)
  const formattedReceiptNumber = apiResp && apiResp.ReceiptNumber
    ? apiResp.ReceiptNumber
    : `HKMI|${new Date().getFullYear()}|D/VSP|${String(receiptNumber).padStart(5, '0')}`;

  console.log('Receipt Service: using receiptNumber:', formattedReceiptNumber, 'apiResp present:', !!apiResp);
  if (apiResp) console.log('Receipt Service: apiResp sample keys:', Object.keys(apiResp));
  const receiptDate = new Date().toLocaleDateString("en-GB");

  const address = `${donation.address}, ${donation.city}, ${donation.state} - ${donation.pincode}`;

  const logoBase64 = fs.readFileSync(
    path.join(__dirname, "../public/hkmi-logo.jpg"),
    "base64"
  );

  const stampBase64 = fs.readFileSync(
    path.join(__dirname, "../public/hkmi-stamp-removebg-preview.png"),
    "base64"
  );

  const amountWords = numberToWords.toWords(donation.amount).toUpperCase() + " RUPEES ONLY";

  console.log('Receipt Service: final apiResp passed to template present:', !!apiResp);
  const html = await ejs.renderFile(templatePath, {
    receiptNumber: formattedReceiptNumber,
    receiptDate,
    donorName: donation.name || "Donor",
    address: address || "N/A",
    patronId: "",
    sevakName: "",
    mobile: donation.mobile || "",
    certificate: donation.certificate === true ? "YES" : "NO",
    email: donation.email || "",
    pan: donation.panNumber || "",
    amount: donation.amount || 0,
    amountWords: amountWords,
    paymentRef: donation.razorpayPaymentId || "",
    paymentDate: receiptDate,
    logoBase64,
    stampBase64
  ,
  externalApiResponse: apiResp
  });

  const execPath = process.env.CHROME_PATH || 
    (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined);

  const launchOptions = {
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--disable-software-rasterizer",
      "--disable-extensions",
    ]
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
      left: 0
    }
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