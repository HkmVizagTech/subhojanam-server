const { connectDb } = require('../src/config/db');
const { donationModle } = require('../src/models/donation.model');
const { generateReceipt } = require('../src/services/receipt.service');

(async () => {
  try {
    await connectDb();
    console.log('DB connected');

    // Create a test donation or use an existing one
    const donation = await donationModle.create({
      name: 'Test Donor',
      email: 'test@example.com',
      mobile: '919999999999',
      amount: 250,
      address: 'Test Address',
      city: 'TestCity',
      state: 'TestState',
      pincode: '123456',
      panNumber: 'ABCDE1234F',
      certificate: true
    });

    console.log('Created donation:', donation._id);

    const filePath = await generateReceipt(donation);
    console.log('Generated PDF at:', filePath);
    process.exit(0);
  } catch (err) {
    console.error('Error in test script:', err);
    process.exit(1);
  }
})();
