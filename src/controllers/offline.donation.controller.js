const { donationModle } = require("../models/donation.model");
const externalDonationService = require("../services/externalDonation.service");
const receiptService = require("../services/receipt.service");
const whatsappService = require("../services/whatsapp.service");

const offlineDonationController = {

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
        sevakName, sevaDate,
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
        sevaDate: sevaDate || "",
        status: "paid",
        webhookProcessed: true,
        webhookProcessedAt: new Date(),
        createdAt: paymentDate ? new Date(paymentDate) : new Date(),
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
