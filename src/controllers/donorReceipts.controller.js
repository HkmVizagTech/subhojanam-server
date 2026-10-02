const { donationModle } = require("../models/donation.model");
const receiptService = require("../services/receipt.service");
const whatsappService = require("../services/whatsapp.service");
const emailService = require("../services/email.service");

const PAID_STATUSES = ["paid", "active", "completed"];

// Real payments only: excludes subscription placeholder records (no payment ref)
const REAL_PAYMENT = {
  status: { $in: PAID_STATUSES },
  amount: { $gte: 1 },
  $or: [
    { razorpayPaymentId: { $exists: true, $nin: [null, ""] } },
    { offlineRefNo: { $exists: true, $nin: [null, ""] } },
  ],
};

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The receipt data DCC already issued for this donation. We never mint a
 * new number here: generateReceipt() invents a LOCAL number when it isn't
 * given one, which would create a receipt DCC knows nothing about.
 */
function issuedReceiptData(donation) {
  const stored = donation.externalApiResponse;
  if (stored?.ReceiptNumber) return stored;
  if (donation.receiptNumber) return { ...(stored || {}), ReceiptNumber: donation.receiptNumber };
  return null;
}

const donorReceiptsController = {
  // Find a donor's payments (one-time, monthly, offline) with receipt status
  search: async (req, res) => {
    try {
      const search = (req.query.search || "").trim();
      if (search.length < 3) {
        return res.status(400).json({ success: false, message: "Enter at least 3 characters (name, mobile, email or subscription ID)" });
      }
      const rx = new RegExp(escapeRegex(search), "i");

      const docs = await donationModle.find({
        ...REAL_PAYMENT,
        $and: [{
          $or: [
            { name: rx }, { mobile: rx }, { email: rx },
            { subscriptionId: search },
          ],
        }],
      })
        .sort({ createdAt: -1 })
        .limit(100)
        .lean();

      const items = docs.map((d) => ({
        id: d._id,
        name: (d.name || "").trim(),
        mobile: d.mobile,
        email: d.email || "",
        amount: d.amount,
        date: d.createdAt,
        type: d.isRecurring ? "monthly" : (d.donationSource === "offline" ? "offline" : "one-time"),
        subscriptionId: d.subscriptionId || "",
        reference: d.razorpayPaymentId || d.offlineRefNo || "",
        receiptNumber: d.receiptNumber || d.externalApiResponse?.ReceiptNumber || "",
        canSend: !!issuedReceiptData(d),
      }));

      res.json({ success: true, count: items.length, items });
    } catch (err) {
      console.error("Donor receipts search error:", err);
      res.status(500).json({ success: false, message: err.message });
    }
  },

  // Re-send already-issued receipts by WhatsApp and/or email.
  // Optional overrides let you reach a donor on a corrected number / address.
  send: async (req, res) => {
    try {
      const { donationIds, whatsapp = true, email = false, phone, toEmail } = req.body || {};

      if (!Array.isArray(donationIds) || donationIds.length === 0) {
        return res.status(400).json({ success: false, message: "Select at least one payment" });
      }
      if (donationIds.length > 24) {
        return res.status(400).json({ success: false, message: "Send at most 24 receipts at a time" });
      }
      if (!whatsapp && !email) {
        return res.status(400).json({ success: false, message: "Choose WhatsApp, email, or both" });
      }

      let overridePhone = null;
      if (phone && String(phone).trim()) {
        const digits = String(phone).replace(/\D/g, "").replace(/^91(?=\d{10}$)/, "");
        if (digits.length !== 10) {
          return res.status(400).json({ success: false, message: "Enter a valid 10-digit mobile number" });
        }
        overridePhone = `91${digits}`;
      }
      const overrideEmail = toEmail && String(toEmail).trim() ? String(toEmail).trim() : null;
      if (overrideEmail && !/^\S+@\S+\.\S+$/.test(overrideEmail)) {
        return res.status(400).json({ success: false, message: "Enter a valid email address" });
      }

      const results = [];

      // Sequential on purpose: the PDF path is derived from the donor's name,
      // so each file must be sent before the next one is generated.
      for (const id of donationIds) {
        const r = { id };
        try {
          const donation = await donationModle.findOne({ _id: id, ...REAL_PAYMENT });
          if (!donation) { r.error = "Payment not found"; results.push(r); continue; }

          r.name = (donation.name || "").trim();
          r.amount = donation.amount;

          const apiResponse = issuedReceiptData(donation);
          if (!apiResponse) {
            r.error = "No receipt was issued for this payment yet — create it from Missed Charges first";
            results.push(r);
            continue;
          }
          r.receiptNumber = apiResponse.ReceiptNumber;

          const filePath = await receiptService.generateReceipt(donation, apiResponse);

          if (whatsapp) {
            try {
              let to = overridePhone;
              if (!to) {
                to = String(donation.mobile).replace(/\D/g, "");
                if (!to.startsWith("91")) to = `91${to}`;
              }
              await whatsappService.sendReceiptWhatsapp(
                to, filePath, donation.name, donation.amount,
                donation.isRecurring ? "subscription" : "normal",
              );
              r.whatsappSentTo = to;
            } catch (waErr) {
              r.whatsappError = waErr?.response?.data?.message || waErr.message;
            }
          }

          if (email) {
            const target = overrideEmail || donation.email;
            if (!target) {
              r.emailError = "No email address on this donation — enter one above";
            } else {
              try {
                await emailService.sendReceiptEmail(target, (donation.name || "").trim(), donation.amount, filePath, apiResponse.ReceiptNumber);
                r.emailSentTo = target;
              } catch (mailErr) {
                r.emailError = mailErr.message;
              }
            }
          }
        } catch (err) {
          r.error = err.message;
        }
        results.push(r);
        await new Promise((resolve) => setTimeout(resolve, 400));
      }

      const delivered = results.filter((r) => r.whatsappSentTo || r.emailSentTo).length;
      res.json({
        success: true,
        message: `${delivered} of ${donationIds.length} receipt(s) delivered`,
        results,
      });
    } catch (err) {
      console.error("Donor receipts send error:", err);
      res.status(500).json({ success: false, message: err.message });
    }
  },
};

module.exports = { donorReceiptsController };
