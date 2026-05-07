// testWhatsapp.js - Version that works from services folder
const { sendReceiptWhatsapp } = require("./whatsapp.service"); // Changed from './src/services/whatsapp.service'
const fs = require("fs");
const path = require("path");
const ejs = require("ejs");
const puppeteer = require("puppeteer");
const numberToWords = require("number-to-words");
require("dotenv").config({ path: path.join(__dirname, "../../.env") }); // Load env from server root

async function createTestReceiptPDF() {
  try {
    console.log("Creating test receipt PDF...");

    // Test data
    const testDonation = {
      name: "Test Donor",
      email: "test@example.com",
      mobile: "916301393962",
      amount: 500,
      address: "123 Test Street",
      city: "Test City",
      state: "Test State",
      pincode: "500001",
      panNumber: "ABCDE1234F",
      certificate: true,
      razorpayPaymentId: "pay_TEST123",
    };

    // Fix path to template - go up two levels to server root, then src/templates
    const templatePath = path.join(
      __dirname,
      "../../src/templates/receipt.ejs",
    );

    // Check if template exists
    if (!fs.existsSync(templatePath)) {
      throw new Error(`Template not found at: ${templatePath}`);
    }

    const formattedReceiptNumber = `HKMI|${new Date().getFullYear()}|D/VSP|00001`;
    const receiptDate = new Date().toLocaleDateString("en-GB");
    const address = `${testDonation.address}, ${testDonation.city}, ${testDonation.state} - ${testDonation.pincode}`;

    // Fix paths for images
    let logoBase64, stampBase64;
    const logoPath = path.join(__dirname, "../../src/public/hkmi-logo.jpg");
    const stampPath = path.join(
      __dirname,
      "../../src/public/hkmi-stamp-removebg-preview.png",
    );

    if (fs.existsSync(logoPath)) {
      logoBase64 = fs.readFileSync(logoPath, "base64");
      console.log("✅ Logo found");
    } else {
      console.warn("⚠️ Logo not found at:", logoPath);
      logoBase64 = "";
    }

    if (fs.existsSync(stampPath)) {
      stampBase64 = fs.readFileSync(stampPath, "base64");
      console.log("✅ Stamp found");
    } else {
      console.warn("⚠️ Stamp not found at:", stampPath);
      stampBase64 = "";
    }

    const amountWords =
      numberToWords.toWords(testDonation.amount).toUpperCase() + " RUPEES ONLY";

    const html = await ejs.renderFile(templatePath, {
      receiptNumber: formattedReceiptNumber,
      receiptDate,
      donorName: testDonation.name,
      address: address,
      patronId: "",
      sevakName: "",
      mobile: testDonation.mobile,
      certificate: testDonation.certificate === true ? "YES" : "NO",
      email: testDonation.email,
      pan: testDonation.panNumber,
      amount: testDonation.amount,
      amountWords: amountWords,
      paymentRef: testDonation.razorpayPaymentId,
      paymentDate: receiptDate,
      logoBase64,
      stampBase64,
      externalApiResponse: null,
    });

    // Launch puppeteer
    const execPath =
      process.env.CHROME_PATH ||
      (process.platform === "darwin"
        ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
        : undefined);

    const launchOpts = {
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    };
    if (execPath) launchOpts.executablePath = execPath;

    const browser = await puppeteer.launch(launchOpts);
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "load" });

    // Create receipts folder in server root
    const receiptsDir = path.join(__dirname, "../../receipts");
    if (!fs.existsSync(receiptsDir))
      fs.mkdirSync(receiptsDir, { recursive: true });

    const fileName = `Test_Receipt.pdf`;
    const filePath = path.join(receiptsDir, fileName);

    await page.pdf({ path: filePath, format: "A4", printBackground: true });
    await browser.close();

    console.log("✅ Test PDF created at:", filePath);
    return filePath;
  } catch (error) {
    console.error("❌ Error creating test PDF:", error);
    throw error;
  }
}

async function testWhatsApp() {
  console.log("\n=== WHATSAPP TEST STARTED ===");
  console.log("Current directory:", __dirname);
  console.log("\nEnvironment check:");
  console.log("- FLAXXA_TOKEN exists:", !!process.env.FLAXXA_TOKEN);
  console.log("- FLAXXA_TOKEN length:", process.env.FLAXXA_TOKEN?.length || 0);
  console.log("- Phone number to test: 916301393962");
  console.log("");

  try {
    // Create a proper receipt PDF
    const testPdfPath = await createTestReceiptPDF();

    console.log("\n📤 Sending WhatsApp message...");
    const result = await sendReceiptWhatsapp(
      "916301393962", // Your phone number
      testPdfPath,
      "Test Donor",
      500,
      "normal",
    );

    console.log("\n✅ WHATSAPP TEST SUCCESSFUL!");
    console.log("WhatsApp API Response:", JSON.stringify(result, null, 2));
  } catch (error) {
    console.error("\n❌ WHATSAPP TEST FAILED!");
    console.error("Error message:", error.message);

    if (error.response) {
      console.error("Response status:", error.response.status);
      console.error(
        "Response data:",
        JSON.stringify(error.response.data, null, 2),
      );
    }

    if (error.request) {
      console.error("No response received from WhatsApp API");
    }

    console.error("\n🔧 Troubleshooting tips:");
    console.error("1. Check if FLAXXA_TOKEN is correct in .env file");
    console.error("2. Verify WhatsApp template names in Flaxxa dashboard");
    console.error("3. Ensure phone number has country code without '+'");
    console.error("4. Check if your Flaxxa account has sufficient balance");
  }
}

// Run the test
testWhatsApp();
