const { donationModle } = require("../models/donation.model");
const externalDonationService = require("../services/externalDonation.service");
const receiptService = require("../services/receipt.service");
const whatsappService = require("../services/whatsapp.service");
// TEMPORARILY DISABLED — birthday/anniversary wishes paused until templates are approved
// const { maybeSendSameDayWish } = require("./wish.controller");

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const last10 = (m) => String(m || "").replace(/\D/g, "").slice(-10);
const { istDayStart } = require("../config/timezone");

const offlineDonationController = {

  // Find existing donors (by name / mobile / email) so a new offline donation
  // can be raised for them with their details pre-filled. Grouped by mobile.
  lookupDonors: async (req, res) => {
    try {
      const search = (req.query.search || "").trim();
      if (search.length < 3) {
        return res.json({ success: true, donors: [] });
      }
      const rx = new RegExp(escapeRegex(search), "i");

      const docs = await donationModle.find({
        status: { $in: ["paid", "active", "completed"] },
        amount: { $gte: 1 },
        $and: [
          { $or: [
            { razorpayPaymentId: { $exists: true, $nin: [null, ""] } },
            { offlineRefNo: { $exists: true, $nin: [null, ""] } },
          ] },
          { $or: [{ name: rx }, { mobile: rx }, { email: rx }] },
        ],
      })
        .sort({ createdAt: -1 })
        .limit(400)
        .lean();

      const groups = new Map();
      for (const d of docs) {
        const key = last10(d.mobile);
        if (key.length !== 10) continue;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(d);
      }

      const donors = [];
      for (const [mobile, recs] of groups) {
        const latest = recs[0]; // docs are newest-first
        const with80G = recs.find((r) => r.panNumber);
        const withPrasadam = recs.find((r) => r.mahaprasadam && r.prasadamAddress);
        const withDob = recs.find((r) => r.dob);
        const withEmail = recs.find((r) => r.email);

        donors.push({
          mobile,
          name: (latest.name || "").trim(),
          email: withEmail?.email || "",
          dob: withDob?.dob || "",
          panNumber: with80G?.panNumber || "",
          address: with80G?.address || "",
          city: with80G?.city || "",
          state: with80G?.state || "",
          pincode: with80G?.pincode || "",
          prasadam: withPrasadam ? {
            name: withPrasadam.prasadamName || "",
            mobile: withPrasadam.prasadamMobile || "",
            address: withPrasadam.prasadamAddress || "",
            city: withPrasadam.prasadamCity || "",
            state: withPrasadam.prasadamState || "",
            pincode: withPrasadam.prasadamPincode || "",
          } : null,
          donationCount: recs.length,
          totalGiven: recs.reduce((sum, r) => sum + (Number(r.amount) || 0), 0),
          lastDonationAt: latest.createdAt,
          lastAmount: latest.amount,
        });
        if (donors.length >= 8) break;
      }

      res.json({ success: true, donors });
    } catch (err) {
      console.error("Offline donor lookup error:", err);
      res.status(500).json({ success: false, message: err.message });
    }
  },


  createOfflineDonation: async (req, res) => {
    try {
      const {
        name, mobile, email,
        amount, offlineRefNo, offlinePaymentMode, paymentDate,
        certificate, panNumber,
        address, city, state, pincode,
        occasion, showInTransactions,
        mahaprasadam, prasadamAddressOption, prasadamName, prasadamMobile, prasadamAddress,
        prasadamCity, prasadamState, prasadamPincode,
        sevakName, sevakMobile, sevaDate,
        dob,
        // The preacher's DCC id number, sent by DRM. Without it DCC records
        // every donation raised this way under the hardcoded default, so a
        // donation a named preacher brought in is credited to nobody.
        dccEnrolledById,
        // The gateway's id when the money came through a Razorpay QR (sent
        // by DRM). Stored in razorpayPaymentId so the admin list shows and
        // searches it like any online payment.
        razorpayPaymentId,
      } = req.body;

      if (!name || !mobile || !amount || !offlineRefNo) {
        return res.status(400).json({ success: false, message: "Name, mobile, amount and reference number are required" });
      }

      // Check duplicate ref number
      const existing = await donationModle.findOne({ offlineRefNo });
      if (existing) {
        return res.status(400).json({ success: false, message: `Reference number already exists (Donation ID: ${existing._id})` });
      }

      const donation = await donationModle.create({
        name,
        mobile,
        email: email || "",
        amount: Number(amount),
        offlineRefNo,
        offlinePaymentMode: offlinePaymentMode || "other",
        ...(razorpayPaymentId ? { razorpayPaymentId: String(razorpayPaymentId).trim() } : {}),
        donationSource: "offline",
        showInTransactions: showInTransactions !== false,
        mahaprasadam: mahaprasadam || false,
        prasadamAddressOption: prasadamAddressOption || "same",
        prasadamName: prasadamName || "",
        prasadamMobile: prasadamMobile || "",
        prasadamAddress: prasadamAddress || "",
        prasadamCity: prasadamCity || "",
        prasadamState: prasadamState || "",
        prasadamPincode: prasadamPincode || "",
        certificate: certificate || false,
        panNumber: panNumber || "",
        // Use prasadam address as main address if certificate address not provided
        address: address || prasadamAddress || "",
        city: city || prasadamCity || "",
        state: state || prasadamState || "",
        pincode: pincode || prasadamPincode || "",
        occasion: occasion || "",
        sevakName: sevakName || "",
        sevakMobile: sevakMobile || "",
        sevaDate: sevaDate || "",
        dob: dob || "",
        // Stored only when it is a real number; anything else is left unset so
        // the DCC default applies exactly as it did before.
        dccEnrolledById:
          dccEnrolledById != null && dccEnrolledById !== "" && Number.isFinite(Number(dccEnrolledById))
            ? Number(dccEnrolledById)
            : undefined,
        status: "paid",
        webhookProcessed: true,
        webhookProcessedAt: new Date(),
        // A backdated offline donation's paymentDate arrives as "YYYY-MM-DD",
        // which new Date() parses as UTC midnight — 05:30 IST, so the stored
        // instant sat 5.5 hours inside the right IST day by luck rather than by
        // design. Anchored to IST midnight it is unambiguously that IST day,
        // which is what the receipt and the DCC filing now read it as.
        createdAt: paymentDate ? istDayStart(paymentDate) : new Date(),
      });

      // 1. DCC API
      let apiResponse = null;
      try {
        apiResponse = await externalDonationService.sendToExternalApi(donation, { id: offlineRefNo });
        await donationModle.findByIdAndUpdate(donation._id, {
          $set: {
            externalApiResponse: apiResponse,
            externalApiSentAt: new Date(),
            donorNumber: apiResponse?.DonorNumber || "",
          },
        });
      } catch (apiErr) {
        await donationModle.findByIdAndDelete(donation._id);
        return res.status(500).json({ success: false, message: `DCC API failed: ${apiErr.message}` });
      }

      // 2. Receipt
      let filePath = null;
      try {
        filePath = await receiptService.generateReceipt(donation, apiResponse);
      } catch (receiptErr) {
        return res.status(500).json({
          success: false,
          message: `Receipt generation failed: ${receiptErr.message}`,
          donationId: donation._id,
          note: "Donation saved and DCC called. Use Missing Receipts to regenerate."
        });
      }

      // 3. WhatsApp
      try {
        let phone = mobile.replace(/\D/g, "");
        if (!phone.startsWith("91")) phone = `91${phone}`;
        await whatsappService.sendReceiptWhatsapp(phone, filePath, name, Number(amount), "normal");
      } catch (waErr) {
        console.error("WhatsApp error:", waErr.message);
      }

      // Trigger same-day birthday/anniversary wish if seva date = today
      // maybeSendSameDayWish(donation).catch(err =>
      //   console.error("[Same-day wish] offline donation error:", err.message)
      // );

      return res.json({
        success: true,
        message: "Offline donation registered, receipt generated and WhatsApp sent",
        donationId: donation._id,
        receiptNumber: apiResponse?.ReceiptNumber || "",
        donorName: name,
        amount: Number(amount),
      });

    } catch (err) {
      console.error("Offline donation error:", err);
      res.status(500).json({ success: false, message: err.message });
    }
  },

};

module.exports = { offlineDonationController };
