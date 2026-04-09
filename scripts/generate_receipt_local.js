const ejs = require('ejs');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const numberToWords = require('number-to-words');

(async () => {
  try {
    const donation = {
      _id: 'local-test-1',
      name: 'Local Test Donor',
      email: 'local@test.com',
      mobile: '919876543210',
      amount: 500,
      address: 'Local Address',
      city: 'LocalCity',
      state: 'LocalState',
      pincode: '500001',
      panNumber: 'ABCDE1234F',
      certificate: true,
      razorpayPaymentId: 'pay_TEST123'
    };

    const apiResponse = {
      DonationId: 12345,
      ReceiptNumber: 'HKMI|2026|D/VSP|00001',
      DonorId: 54321,
      DonorNumber: 'D54321',
      Message: 'Test response from external API'
    };

    const templatePath = path.join(__dirname, '../src/templates/receipt.ejs');

    const formattedReceiptNumber = `HKMI|${new Date().getFullYear()}|D/VSP|00001`;
    const receiptDate = new Date().toLocaleDateString('en-GB');
    const address = `${donation.address}, ${donation.city}, ${donation.state} - ${donation.pincode}`;

    const logoBase64 = fs.readFileSync(path.join(__dirname, '../src/public/hkmi-logo.jpg'), 'base64');
    const stampBase64 = fs.readFileSync(path.join(__dirname, '../src/public/hkmi-stamp-removebg-preview.png'), 'base64');
    const amountWords = numberToWords.toWords(donation.amount).toUpperCase() + ' RUPEES ONLY';

    const html = await ejs.renderFile(templatePath, {
      receiptNumber: formattedReceiptNumber,
      receiptDate,
      donorName: donation.name || 'Donor',
      address: address || 'N/A',
      patronId: '',
      sevakName: '',
      mobile: donation.mobile || '',
      certificate: donation.certificate === true ? 'YES' : 'NO',
      email: donation.email || '',
      pan: donation.panNumber || '',
      amount: donation.amount || 0,
      amountWords: amountWords,
      paymentRef: donation.razorpayPaymentId || '',
      paymentDate: receiptDate,
      logoBase64,
      stampBase64,
      externalApiResponse: apiResponse
    });

  const execPath = process.env.CHROME_PATH || (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined);
  const launchOpts = { headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] };
  if (execPath) launchOpts.executablePath = execPath;
  const browser = await puppeteer.launch(launchOpts);
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'load' });

    const receiptsDir = path.join(__dirname, '../receipts');
    if (!fs.existsSync(receiptsDir)) fs.mkdirSync(receiptsDir, { recursive: true });

    const safeName = donation.name.replace(/\s+/g, '_');
    const fileName = `Local_Receipt_${safeName}.pdf`;
    const filePath = path.join(receiptsDir, fileName);

    await page.pdf({ path: filePath, format: 'A4', printBackground: true });
    await browser.close();

    console.log('PDF generated at:', filePath);
  } catch (err) {
    console.error('Local generate error:', err);
    process.exit(1);
  }
})();
