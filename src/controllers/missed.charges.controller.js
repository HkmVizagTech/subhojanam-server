const { donationModle } = require("../models/donation.model");
const { razorpay } = require("../config/razorpay");
const externalDonationService = require("../services/externalDonation.service");
const receiptService = require("../services/receipt.service");
const whatsappService = require("../services/whatsapp.service");

const missedChargesController = {

  getMissedCharges: async (req, res) => {
    try {
      const localSubs = await donationModle.find({
        isRecurring: true,
        subscriptionId: { $exists: true, $ne: null }
      }).sort({ createdAt: 1 });

      const seen = new Set();
      const uniqueSubs = localSubs.filter(sub => {
        if (seen.has(sub.subscriptionId)) return false;
        seen.add(sub.subscriptionId);
        return true;
      });

      const missed = [];

      for (const sub of uniqueSubs) {
        try {
          const razorPayments = await razorpay.subscriptions.fetchAllPayments(sub.subscriptionId);
          const razorItems = razorPayments.items || [];

          for (const payment of razorItems) {
            if (payment.status !== "captured") continue;

            const exists = await donationModle.findOne({ razorpayPaymentId: payment.id });
            if (!exists) {
              missed.push({
                subscriptionId: sub.subscriptionId,
                paymentId: payment.id,
                amount: payment.amount / 100,
                date: new Date(payment.created_at * 1000),
                donorName: sub.name,
                donorMobile: sub.mobile,
                donorEmail: sub.email,
              });
            }
          }
        } catch (err) {
          console.error(`Error fetching payments for ${sub.subscriptionId}:`, err.message);
        }
      }

      res.status(200).json({ success: true, count: missed.length, data: missed });

    } catch (error) {
      console.error("Get Missed Charges Error:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  },

  registerMissedCharge: async (req, res) => {
    try {
      const { subscriptionId, paymentId } = req.body;

      if (!subscriptionId || !paymentId) {
        return res.status(400).json({ success: false, message: "subscriptionId and paymentId are required" });
      }

      // Prevent duplicate
      const existing = await donationModle.findOne({ razorpayPaymentId: paymentId });
      if (existing) {
        return res.status(400).json({ success: false, message: "Payment already registered", donationId: existing._id });
      }

      // Get original subscription donor details
      const originalDonation = await donationModle.findOne({ subscriptionId }).sort({ createdAt: 1 });
      if (!originalDonation) {
        return res.status(404).json({ success: false, message: "Original subscription not found" });
      }

      // Fetch payment details from Razorpay for amount
      const razorPayment = await razorpay.payments.fetch(paymentId);

      // Create donation record
      const newDonation = await donationModle.create({
        name: originalDonation.name,
        email: originalDonation.email,
        mobile: originalDonation.mobile,
        amount: razorPayment.amount / 100,
        certificate: originalDonation.certificate,
        panNumber: originalDonation.panNumber,
        address: originalDonation.address,
        city: originalDonation.city,
        state: originalDonation.state,
        pincode: originalDonation.pincode,
        occasion: originalDonation.occasion,
        mahaprasadam: originalDonation.mahaprasadam,
        prasadamAddressOption: originalDonation.prasadamAddressOption,
        prasadamAddress: originalDonation.prasadamAddress,
        utm: originalDonation.utm,
        subscriptionId,
        isRecurring: true,
        razorpayPaymentId: paymentId,
        status: "paid",
        webhookProcessed: true,
        webhookProcessedAt: new Date(),
      });

      // DCC API
      let apiResponse = null;
      try {
        apiResponse = await externalDonationService.sendToExternalApi(newDonation, { id: paymentId });
        await donationModle.findByIdAndUpdate(newDonation._id, {
          $set: { externalApiResponse: apiResponse, externalApiSentAt: new Date(), donorNumber: apiResponse?.DonorNumber || "" },
        });
      } catch (apiErr) {
        await donationModle.findByIdAndDelete(newDonation._id);
        return res.status(500).json({ success: false, message: `DCC API failed: ${apiErr.message}` });
      }

      // Receipt
      let filePath = null;
      try {
        filePath = await receiptService.generateReceipt(newDonation, apiResponse);
      } catch (receiptErr) {
        return res.status(500).json({ success: false, message: `Receipt generation failed: ${receiptErr.message}`, donationId: newDonation._id });
      }

      // WhatsApp
      try {
        let phone = newDonation.mobile.replace(/\D/g, "");
        if (!phone.startsWith("91")) phone = `91${phone}`;
        await whatsappService.sendReceiptWhatsapp(phone, filePath, newDonation.name, newDonation.amount, "subscription");
      } catch (waErr) {
        console.error("WhatsApp error (receipt already saved):", waErr.message);
      }

      return res.json({
        success: true,
        message: "Donation registered, receipt generated and WhatsApp sent",
        donationId: newDonation._id,
        donorName: newDonation.name,
        amount: newDonation.amount,
      });

    } catch (err) {
      console.error("Register Missed Charge Error:", err);
      res.status(500).json({ success: false, message: err.message });
    }
  },

};

module.exports = { missedChargesController };
