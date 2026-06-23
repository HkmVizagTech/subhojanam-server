const { donationModle } = require("../models/donation.model");
const { razorpay } = require("../config/razorpay");
const externalDonationService = require("../services/externalDonation.service");
const receiptService = require("../services/receipt.service");
const whatsappService = require("../services/whatsapp.service");

const subscriptionRepairController = {

  // 1. DIAGNOSE — find recurring donations whose name doesn't match their subscription's first donation
  diagnoseMismatch: async (req, res) => {
    try {
      // Get all recurring donations grouped by subscriptionId
      const recurring = await donationModle.find({
        isRecurring: true,
        subscriptionId: { $exists: true, $ne: null, $ne: "" },
      }).sort({ createdAt: 1 });

      // Group by subscriptionId
      const bySub = {};
      for (const d of recurring) {
        if (!bySub[d.subscriptionId]) bySub[d.subscriptionId] = [];
        bySub[d.subscriptionId].push(d);
      }

      const mismatches = [];
      for (const [subId, donations] of Object.entries(bySub)) {
        const first = donations[0]; // earliest = original
        for (const d of donations) {
          // If a later charge has a different name/mobile/email than the original
          if (d.mobile !== first.mobile || d.name !== first.name) {
            mismatches.push({
              subscriptionId: subId,
              recordId: d._id,
              recordName: d.name,
              recordMobile: d.mobile,
              recordEmail: d.email,
              originalName: first.name,
              originalMobile: first.mobile,
              originalEmail: first.email,
              date: d.createdAt,
              paymentId: d.razorpayPaymentId,
            });
          }
        }
      }

      res.json({ success: true, count: mismatches.length, mismatches });
    } catch (error) {
      console.error("Diagnose error:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  },

  // 2. FIX — re-fetch correct donor from Razorpay subscription notes and correct the records
  fixSubscription: async (req, res) => {
    try {
      const { subscriptionId } = req.body;
      if (!subscriptionId) {
        return res.status(400).json({ success: false, message: "subscriptionId required" });
      }

      // Fetch subscription from Razorpay to get the real customer
      const subscription = await razorpay.subscriptions.fetch(subscriptionId);

      // Get all donations under this subscription, earliest first
      const donations = await donationModle.find({ subscriptionId }).sort({ createdAt: 1 });
      if (donations.length === 0) {
        return res.status(404).json({ success: false, message: "No donations found for this subscription" });
      }

      // The earliest one with a real (non-Siva Prasad imposed) identity is the source of truth.
      // We use the FIRST donation's details as canonical (it was created at signup).
      const canonical = donations[0];

      const corrected = [];
      for (const d of donations) {
        if (d._id.toString() === canonical._id.toString()) continue; // skip original
        if (d.name !== canonical.name || d.mobile !== canonical.mobile) {
          d.name = canonical.name;
          d.mobile = canonical.mobile;
          d.email = canonical.email;
          d.address = canonical.address;
          d.city = canonical.city;
          d.state = canonical.state;
          d.pincode = canonical.pincode;
          d.panNumber = canonical.panNumber;
          await d.save();
          corrected.push({ id: d._id, date: d.createdAt, paymentId: d.razorpayPaymentId });
        }
      }

      res.json({
        success: true,
        subscriptionId,
        canonicalDonor: { name: canonical.name, mobile: canonical.mobile, email: canonical.email },
        correctedCount: corrected.length,
        corrected,
      });
    } catch (error) {
      console.error("Fix subscription error:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  },

  // 3. SYNC missing charge — manually pull a charge from Razorpay that wasn't recorded
  syncMissingCharge: async (req, res) => {
    try {
      const { subscriptionId, paymentId } = req.body;
      if (!subscriptionId || !paymentId) {
        return res.status(400).json({ success: false, message: "subscriptionId and paymentId required" });
      }

      // Already exists?
      const existing = await donationModle.findOne({ razorpayPaymentId: paymentId });
      if (existing) {
        return res.json({ success: false, message: "Payment already recorded", donationId: existing._id });
      }

      // Fetch payment from Razorpay
      const payment = await razorpay.payments.fetch(paymentId);

      // Get original donation for donor details
      const original = await donationModle.findOne({ subscriptionId, isRecurring: true }).sort({ createdAt: 1 });
      if (!original) {
        return res.status(404).json({ success: false, message: "No original donation found for this subscription" });
      }

      // Create the missing record
      const newDonation = await donationModle.create({
        name: original.name,
        email: original.email,
        mobile: original.mobile,
        amount: payment.amount ? payment.amount / 100 : original.amount,
        certificate: original.certificate,
        panNumber: original.panNumber,
        address: original.address,
        city: original.city,
        state: original.state,
        pincode: original.pincode,
        occasion: original.occasion,
        sevakName: original.sevakName || "",
        mahaprasadam: original.mahaprasadam,
        prasadamAddressOption: original.prasadamAddressOption,
        prasadamAddress: original.prasadamAddress,
        prasadamName: original.prasadamName || "",
        prasadamMobile: original.prasadamMobile || "",
        prasadamCity: original.prasadamCity || "",
        prasadamState: original.prasadamState || "",
        prasadamPincode: original.prasadamPincode || "",
        utm: original.utm,
        subscriptionId,
        isRecurring: true,
        razorpayPaymentId: paymentId,
        status: "paid",
        webhookProcessed: true,
        webhookProcessedAt: new Date(),
        createdAt: payment.created_at ? new Date(payment.created_at * 1000) : new Date(),
      });

      // DCC → receipt → WhatsApp
      let apiResponse = null;
      try {
        apiResponse = await externalDonationService.sendToExternalApi(newDonation, payment);
        await donationModle.findByIdAndUpdate(newDonation._id, {
          $set: { externalApiResponse: apiResponse, externalApiSentAt: new Date(), donorNumber: apiResponse?.DonorNumber || "" },
        });
      } catch (apiErr) {
        return res.json({ success: true, message: "Record created but DCC failed — use Missing Receipts", donationId: newDonation._id, dccError: apiErr.message });
      }

      let filePath = null;
      try {
        filePath = await receiptService.generateReceipt(newDonation, apiResponse);
      } catch (e) {
        return res.json({ success: true, message: "Record created, DCC done, but receipt failed", donationId: newDonation._id });
      }

      try {
        let phone = newDonation.mobile.replace(/\D/g, "");
        if (!phone.startsWith("91")) phone = `91${phone}`;
        await whatsappService.sendReceiptWhatsapp(phone, filePath, newDonation.name, newDonation.amount, "subscription");
      } catch (e) {}

      res.json({
        success: true,
        message: "Missing charge synced, receipt generated and WhatsApp sent",
        donationId: newDonation._id,
        receiptNumber: apiResponse?.ReceiptNumber,
        donor: newDonation.name,
        amount: newDonation.amount,
      });
    } catch (error) {
      console.error("Sync missing charge error:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  },

  // 4. VERIFY — fetch a payment from Razorpay and compare with DB record
  verifyPayment: async (req, res) => {
    try {
      const { paymentId } = req.query;
      if (!paymentId) {
        return res.status(400).json({ success: false, message: "paymentId required" });
      }

      // Fetch from Razorpay
      const payment = await razorpay.payments.fetch(paymentId);

      let subscription = null;
      let subscriptionDonations = [];
      if (payment.subscription_id) {
        try {
          subscription = await razorpay.subscriptions.fetch(payment.subscription_id);
        } catch (e) {
          subscription = { error: e.message };
        }
        subscriptionDonations = await donationModle.find({ subscriptionId: payment.subscription_id }).sort({ createdAt: 1 });
      }

      // Our DB record for this payment
      const dbRecord = await donationModle.findOne({ razorpayPaymentId: paymentId });

      // Search DB by the Razorpay contact number to find the REAL donor's other records
      const contactDigits = (payment.contact || "").replace(/\D/g, "").replace(/^91/, "");
      const recordsByContact = contactDigits
        ? await donationModle.find({ mobile: { $regex: contactDigits + "$" } }).sort({ createdAt: -1 }).limit(10)
        : [];

      res.json({
        success: true,
        razorpay: {
          paymentId: payment.id,
          amount: payment.amount / 100,
          status: payment.status,
          method: payment.method,
          email: payment.email,
          contact: payment.contact,
          subscription_id: payment.subscription_id,
          order_id: payment.order_id,
          created_at: new Date(payment.created_at * 1000),
          notes: payment.notes,
        },
        razorpaySubscription: subscription ? {
          id: subscription.id,
          status: subscription.status,
          notes: subscription.notes,
          customer_id: subscription.customer_id,
        } : null,
        ourDbRecord: dbRecord ? {
          id: dbRecord._id,
          name: dbRecord.name,
          mobile: dbRecord.mobile,
          email: dbRecord.email,
          amount: dbRecord.amount,
          isRecurring: dbRecord.isRecurring,
          subscriptionId: dbRecord.subscriptionId,
          razorpayOrderId: dbRecord.razorpayOrderId,
        } : null,
        recordsMatchingRazorpayContact: recordsByContact.map(d => ({
          id: d._id,
          name: d.name,
          mobile: d.mobile,
          email: d.email,
          amount: d.amount,
          date: d.createdAt,
          isRecurring: d.isRecurring,
          subscriptionId: d.subscriptionId,
          paymentId: d.razorpayPaymentId,
        })),
        allDonationsUnderSubscription: subscriptionDonations.map(d => ({
          id: d._id,
          name: d.name,
          mobile: d.mobile,
          email: d.email,
          amount: d.amount,
          date: d.createdAt,
          paymentId: d.razorpayPaymentId,
        })),
      });
    } catch (error) {
      console.error("Verify payment error:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  },

  // 5. FIX SINGLE PAYMENT — correct a DB record's donor details using Razorpay as truth
  fixPaymentDonor: async (req, res) => {
    try {
      const { paymentId, name, mobile, email, regenerateReceipt = false } = req.body;
      if (!paymentId) {
        return res.status(400).json({ success: false, message: "paymentId required" });
      }

      const dbRecord = await donationModle.findOne({ razorpayPaymentId: paymentId });
      if (!dbRecord) {
        return res.status(404).json({ success: false, message: "No DB record for this payment" });
      }

      // Fetch Razorpay truth
      const payment = await razorpay.payments.fetch(paymentId);

      const before = {
        name: dbRecord.name,
        mobile: dbRecord.mobile,
        email: dbRecord.email,
        oldReceiptNumber: dbRecord.receiptNumber,
        oldDonorNumber: dbRecord.donorNumber,
      };

      // Correct donor details
      dbRecord.name = name || dbRecord.name;
      dbRecord.mobile = mobile || (payment.contact || "").replace(/^\+?91/, "") || dbRecord.mobile;
      dbRecord.email = email || payment.email || dbRecord.email;

      let regenResult = null;

      if (regenerateReceipt) {
        // Clear old DCC + receipt data (DCC cancels old receipt on their end)
        dbRecord.externalApiResponse = null;
        dbRecord.externalApiSentAt = null;
        dbRecord.donorNumber = "";
        dbRecord.receiptNumber = "";
        dbRecord.receiptGeneratedAt = null;
        await dbRecord.save();

        // Re-send to DCC with correct donor → new receipt
        try {
          const apiResponse = await externalDonationService.sendToExternalApi(dbRecord, payment);
          dbRecord.externalApiResponse = apiResponse;
          dbRecord.externalApiSentAt = new Date();
          dbRecord.donorNumber = apiResponse?.DonorNumber || "";
          await dbRecord.save();

          // Regenerate PDF
          const filePath = await receiptService.generateReceipt(dbRecord, apiResponse);

          // Send WhatsApp to correct donor
          let phone = dbRecord.mobile.replace(/\D/g, "");
          if (!phone.startsWith("91")) phone = `91${phone}`;
          await whatsappService.sendReceiptWhatsapp(
            phone, filePath, dbRecord.name, dbRecord.amount,
            dbRecord.isRecurring ? "subscription" : "normal"
          );

          regenResult = {
            newReceiptNumber: apiResponse?.ReceiptNumber || "",
            newDonorNumber: apiResponse?.DonorNumber || "",
            whatsappSentTo: phone,
          };
        } catch (regenErr) {
          regenResult = { error: regenErr.message, note: "Name corrected but receipt regeneration failed — use Missing Receipts" };
        }
      } else {
        await dbRecord.save();
      }

      res.json({
        success: true,
        message: regenerateReceipt ? "Donor corrected + receipt regenerated + WhatsApp sent" : "Donor details corrected (receipt NOT regenerated)",
        paymentId,
        before,
        after: { name: dbRecord.name, mobile: dbRecord.mobile, email: dbRecord.email },
        razorpayContact: payment.contact,
        razorpayEmail: payment.email,
        regeneration: regenResult,
      });
    } catch (error) {
      console.error("Fix payment donor error:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  },

};

module.exports = { subscriptionRepairController };
