const { donationModle } = require("../models/donation.model");
const externalDonationService = require("../services/externalDonation.service");
const receiptService = require("../services/receipt.service");
const whatsappService = require("../services/whatsapp.service");

const pendingTransactionsController = {
  // List donations stuck in "created" (payment started, never completed)
  list: async (req, res) => {
    try {
      const { search = "", page = 1, limit = 20 } = req.query;
      const query = { status: "created" };
      if (search) {
        query.$or = [
          { name: { $regex: search, $options: "i" } },
          { mobile: { $regex: search, $options: "i" } },
          { email: { $regex: search, $options: "i" } },
        ];
      }

      const pageNum = Math.max(parseInt(page) || 1, 1);
      const limitNum = Math.min(parseInt(limit) || 20, 100);

      const [total, docs] = await Promise.all([
        donationModle.countDocuments(query),
        donationModle.find(query)
          .sort({ createdAt: -1 })
          .skip((pageNum - 1) * limitNum)
          .limit(limitNum)
          .lean(),
      ]);

      // Hint for the admin: did this donor already complete a same-amount
      // payment afterwards? Then this pending record is probably just stale.
      const items = await Promise.all(docs.map(async (d) => {
        const laterPaid = await donationModle.exists({
          mobile: d.mobile,
          amount: d.amount,
          status: { $in: ["paid", "active", "completed"] },
          createdAt: { $gt: d.createdAt },
        });
        return {
          id: d._id,
          name: d.name,
          mobile: d.mobile,
          email: d.email,
          amount: d.amount,
          isRecurring: !!d.isRecurring,
          createdAt: d.createdAt,
          occasion: d.occasion || "",
          sevaDate: d.sevaDate || "",
          sevakName: d.sevakName || "",
          certificate: !!d.certificate,
          panNumber: d.panNumber || "",
          address: d.address || "",
          city: d.city || "",
          state: d.state || "",
          pincode: d.pincode || "",
          mahaprasadam: !!d.mahaprasadam,
          prasadamName: d.prasadamName || "",
          prasadamMobile: d.prasadamMobile || "",
          prasadamAddress: d.prasadamAddress || "",
          prasadamCity: d.prasadamCity || "",
          prasadamState: d.prasadamState || "",
          prasadamPincode: d.prasadamPincode || "",
          reminded: !!(d.whatsappPendingReminderSent || d.emailPendingReminderSent),
          laterPaidSameAmount: !!laterPaid,
          utmCampaign: d.utm?.campaign || "",
        };
      }));

      res.json({ success: true, total, page: pageNum, limit: limitNum, items });
    } catch (err) {
      console.error("Pending list error:", err);
      res.status(500).json({ success: false, message: err.message });
    }
  },

  // Convert a pending record into a paid one using the UTR / payment reference
  // the donor provided, optionally correcting or adding details (prasadam, PAN,
  // address...). Then DCC -> receipt PDF -> WhatsApp, same as an offline donation.
  // If DCC fails the record is restored to "created" — never deleted.
  markPaid: async (req, res) => {
    try {
      const { id } = req.params;
      const b = req.body || {};
      const utr = (b.utr || "").trim();
      if (!utr) {
        return res.status(400).json({ success: false, message: "UTR / payment reference is required" });
      }

      let donation = await donationModle.findById(id);
      if (!donation) return res.status(404).json({ success: false, message: "Record not found" });
      if (donation.status !== "created") {
        return res.status(400).json({ success: false, message: `Record is already '${donation.status}', not pending` });
      }
      if (donation.isRecurring) {
        return res.status(400).json({
          success: false,
          message: "This is a monthly-subscription signup. Use Subscription Repair to sync its Razorpay payment instead.",
        });
      }

      const dup = await donationModle.findOne({
        _id: { $ne: donation._id },
        $or: [{ offlineRefNo: utr }, { razorpayPaymentId: utr }],
      });
      if (dup) {
        return res.status(400).json({ success: false, message: `This reference is already used by another record (ID: ${dup._id})` });
      }

      const amount = b.amount !== undefined && b.amount !== "" ? Number(b.amount) : donation.amount;
      if (!amount || amount < 1) {
        return res.status(400).json({ success: false, message: "Valid amount required" });
      }

      // Snapshot so we can restore on DCC failure
      const snapshot = donation.toObject();

      const str = (v, fallback) => (v !== undefined && v !== null ? String(v) : fallback);

      donation.name = str(b.name, donation.name) || donation.name;
      donation.mobile = str(b.mobile, donation.mobile) || donation.mobile;
      donation.email = str(b.email, donation.email);
      donation.amount = amount;
      donation.occasion = str(b.occasion, donation.occasion);
      donation.sevakName = str(b.sevakName, donation.sevakName);
      donation.sevaDate = str(b.sevaDate, donation.sevaDate);

      if (b.certificate !== undefined) donation.certificate = !!b.certificate;
      donation.panNumber = str(b.panNumber, donation.panNumber);
      donation.address = str(b.address, donation.address);
      donation.city = str(b.city, donation.city);
      donation.state = str(b.state, donation.state);
      donation.pincode = str(b.pincode, donation.pincode);

      if (b.mahaprasadam !== undefined) donation.mahaprasadam = !!b.mahaprasadam;
      if (donation.mahaprasadam) {
        donation.prasadamAddressOption = b.prasadamAddress ? "different" : (donation.prasadamAddressOption || "same");
        donation.prasadamName = str(b.prasadamName, donation.prasadamName) || donation.name;
        donation.prasadamMobile = str(b.prasadamMobile, donation.prasadamMobile) || donation.mobile;
        donation.prasadamAddress = str(b.prasadamAddress, donation.prasadamAddress);
        donation.prasadamCity = str(b.prasadamCity, donation.prasadamCity);
        donation.prasadamState = str(b.prasadamState, donation.prasadamState);
        donation.prasadamPincode = str(b.prasadamPincode, donation.prasadamPincode);
        donation.prasadamDeliveryStatus = "pending";
        // Same fallback the offline form uses
        donation.address = donation.address || donation.prasadamAddress;
        donation.city = donation.city || donation.prasadamCity;
        donation.state = donation.state || donation.prasadamState;
        donation.pincode = donation.pincode || donation.prasadamPincode;
      }

      donation.status = "paid";
      donation.donationSource = "offline";
      donation.offlineRefNo = utr;
      donation.offlinePaymentMode = b.paymentMode || "other";
      donation.webhookProcessed = true;
      donation.webhookProcessedAt = new Date();
      await donation.save();

      // Receipt/DCC date must be the real payment date, not when checkout started.
      // createdAt is immutable in Mongoose, so write it at collection level and reload.
      const paidOn = b.paymentDate ? new Date(b.paymentDate) : new Date();
      await donationModle.collection.updateOne({ _id: donation._id }, { $set: { createdAt: paidOn } });
      donation = await donationModle.findById(donation._id);

      const restore = async () => {
        await donationModle.collection.replaceOne({ _id: donation._id }, snapshot);
      };

      // 1. DCC
      let apiResponse = null;
      try {
        apiResponse = await externalDonationService.sendToExternalApi(donation, { id: utr });
        await donationModle.findByIdAndUpdate(donation._id, {
          $set: {
            externalApiResponse: apiResponse,
            externalApiSentAt: new Date(),
            donorNumber: apiResponse?.DonorNumber || "",
          },
        });
      } catch (apiErr) {
        await restore();
        return res.status(500).json({
          success: false,
          message: `DCC API failed: ${apiErr?.response?.data?.Message || apiErr.message}. Record left as pending — nothing changed.`,
        });
      }

      // 2. Receipt PDF
      let filePath = null;
      try {
        filePath = await receiptService.generateReceipt(donation, apiResponse);
      } catch (receiptErr) {
        return res.status(500).json({
          success: false,
          message: `Marked paid and registered in DCC, but PDF failed: ${receiptErr.message}. Use Missed Charges → Generate to retry.`,
          donationId: donation._id,
        });
      }

      // 3. WhatsApp
      let whatsappSent = false;
      try {
        let phone = String(donation.mobile).replace(/\D/g, "");
        if (!phone.startsWith("91")) phone = `91${phone}`;
        await whatsappService.sendReceiptWhatsapp(phone, filePath, donation.name, donation.amount, "normal");
        whatsappSent = true;
      } catch (waErr) {
        console.error("WhatsApp error (mark-paid):", waErr.message);
      }

      res.json({
        success: true,
        message: whatsappSent
          ? "Marked as paid — receipt generated and WhatsApp sent"
          : "Marked as paid — receipt generated (WhatsApp could not be sent)",
        donationId: donation._id,
        receiptNumber: apiResponse?.ReceiptNumber || "",
        whatsappSent,
      });
    } catch (err) {
      console.error("Mark paid error:", err);
      res.status(500).json({ success: false, message: err.message });
    }
  },

  // Close a pending record that will never be completed. Kept for history
  // (status "cancelled") but removed from the pending list and reminders.
  close: async (req, res) => {
    try {
      const { id } = req.params;
      const reason = ((req.body || {}).reason || "").trim();

      const donation = await donationModle.findById(id);
      if (!donation) return res.status(404).json({ success: false, message: "Record not found" });
      if (donation.status !== "created") {
        return res.status(400).json({ success: false, message: `Record is already '${donation.status}', not pending` });
      }

      donation.status = "cancelled";
      donation.closedReason = reason || "Closed by admin";
      donation.closedAt = new Date();
      await donation.save();

      res.json({ success: true, message: "Pending record closed" });
    } catch (err) {
      console.error("Close pending error:", err);
      res.status(500).json({ success: false, message: err.message });
    }
  },
};

module.exports = { pendingTransactionsController };
