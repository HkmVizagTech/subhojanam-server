const crypto = require('crypto');
require('dotenv').config();

(async () => {
  try {
    const webhook = require('../src/controllers/webhook.controller').webHookControler.webhook;
    const donationModel = require('../src/models/donation.model').donationModle;
    const externalService = require('../src/services/externalDonation.service');
    const receiptService = require('../src/services/receipt.service');
    const whatsapp = require('../src/services/whatsapp.service');

    // Stub external API sender to see invocation
    let externalCalled = false;
    const fakeApiResp = {
      DonationId: 999999,
      ReceiptNumber: 'HKMI|2026|D/VSP|TEST999',
      DonorId: 12345,
      DonorNumber: 'D12345',
      Message: 'Test response'
    };

    externalService._orig = externalService.sendToExternalApi;
    externalService.sendToExternalApi = async (donation, payment) => {
      console.log('TEST STUB: sendToExternalApi called with donation id/name:', donation._id || donation.name, 'payment id:', payment && payment.id);
      externalCalled = true;
      return fakeApiResp;
    };

    // Stub generateReceipt to avoid puppeteer
    receiptService._orig = receiptService.generateReceipt;
    receiptService.generateReceipt = async (donation, apiResponse) => {
      console.log('TEST STUB: generateReceipt called. donation:', donation._id || donation.name, 'apiResponse keys:', apiResponse && Object.keys(apiResponse));
      return '/tmp/fake_receipt.pdf';
    };

    // Stub sendReceiptWhatsapp to avoid network
    whatsapp._orig = whatsapp.sendReceiptWhatsapp;
    whatsapp.sendReceiptWhatsapp = async () => {
      console.log('TEST STUB: sendReceiptWhatsapp called');
      return { success: true };
    };

    // Stub donation model methods used by webhook
    const fakeDonation = {
      _id: 'fake123',
      name: 'Fake Donor',
      mobile: '919876543210',
      amount: 500,
      certificate: false,
      subscriptionId: null,
      isRecurring: false,
      receiptNumber: null
    };

    donationModel._orig = {
      findOne: donationModel.findOne,
      findOneAndUpdate: donationModel.findOneAndUpdate,
      findById: donationModel.findById,
      findByIdAndUpdate: donationModel.findByIdAndUpdate
    };

    donationModel.findOne = async (q) => {
      console.log('TEST STUB: donationModel.findOne called with', q);
      // return existing donation when searching by order id
      if (q && q.razorpayOrderId) return fakeDonation;
      return null;
    };
    donationModel.findOneAndUpdate = async (q, update, opts) => {
      console.log('TEST STUB: donationModel.findOneAndUpdate called with', q, update);
      // return updated donation object
      return Object.assign({}, fakeDonation, update);
    };
    donationModel.findById = async (id) => {
      console.log('TEST STUB: donationModel.findById called with', id);
      return Object.assign({}, fakeDonation);
    };
    donationModel.findByIdAndUpdate = async (id, update) => {
      console.log('TEST STUB: donationModel.findByIdAndUpdate called with', id, update);
      return Object.assign({}, fakeDonation, update.$set);
    };

    // Craft a fake razorpay webhook body for payment.captured
    const event = {
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: 'pay_TEST_123',
            order_id: 'order_TEST_abc'
          }
        }
      }
    };

    const bodyStr = JSON.stringify(event);
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET || 'subhonojanamwebhook';
    const signature = crypto.createHmac('sha256', webhookSecret).update(bodyStr).digest('hex');

    // Fake req/res objects
    const req = {
      headers: {
        'x-razorpay-signature': signature
      },
      body: Buffer.from(bodyStr)
    };

    const res = {
      status: (code) => ({ send: (msg) => console.log('RES status', code, msg), json: (o) => console.log('RES json', o) }),
      send: (s) => console.log('RES send', s)
    };

    console.log('--- Starting simulated webhook call ---');
    await webhook(req, res);
    console.log('--- Simulated webhook finished ---');

    // restore stubs
    externalService.sendToExternalApi = externalService._orig;
    receiptService.generateReceipt = receiptService._orig;
    whatsapp.sendReceiptWhatsapp = whatsapp._orig;
    donationModel.findOne = donationModel._orig.findOne;
    donationModel.findOneAndUpdate = donationModel._orig.findOneAndUpdate;
    donationModel.findById = donationModel._orig.findById;
    donationModel.findByIdAndUpdate = donationModel._orig.findByIdAndUpdate;

    if (externalCalled) console.log('TEST RESULT: external API was called during webhook flow');
    else console.log('TEST RESULT: external API was NOT called');

    process.exit(0);
  } catch (err) {
    console.error('Test script error:', err);
    process.exit(1);
  }
})();
