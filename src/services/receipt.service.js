const puppeteer = require("puppeteer");
const ejs = require("ejs");
const fs = require("fs");
const path = require("path");
const { settingsModel } = require("../models/settings.model");
const { donationModle } = require("../models/donation.model");
const numberToWords = require("number-to-words");

const generateReceipt = async (donation) => {
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

  const formattedReceiptNumber = `HKMI|${new Date().getFullYear()}|D/VSP|${String(receiptNumber).padStart(5, '0')}`;
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
  });

  const browser = await puppeteer.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--disable-software-rasterizer",
      "--disable-extensions",
    ]
  });

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