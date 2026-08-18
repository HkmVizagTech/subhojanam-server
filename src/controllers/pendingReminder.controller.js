const { donationModle } = require("../models/donation.model");
const { sendPendingWhatsapp } = require("../services/whatsapp.service");
const { sendPendingPaymentEmail } = require("../services/email.service");

/**
 * Finds donations stuck in "created" (payment initiated but never completed)
 * for at least 6 minutes, and sends a one-time reminder on BOTH WhatsApp and
 * email (independently tracked — a failure on one channel never blocks the
 * other, and each channel is only ever sent once per donation).
 */
async function runPendingReminders() {
  const cutoff = new Date(Date.now() - 6 * 60 * 1000);

  const pendingDonations = await donationModle.find({
    status: "created",
    createdAt: { $lte: cutoff },
    $or: [
      { whatsappPendingReminderSent: { $ne: true } },
      { emailPendingReminderSent: { $ne: true } },
    ],
  });

  const results = { whatsappSent: [], emailSent: [], errors: [] };

  for (const donation of pendingDonations) {
    // --- WhatsApp channel ---
    if (!donation.whatsappPendingReminderSent && donation.mobile) {
      try {
        let phone = donation.mobile.replace(/\D/g, "");
        if (!phone.startsWith("91")) phone = `91${phone}`;

        await sendPendingWhatsapp(phone, donation.name, donation.amount);

        donation.whatsappPendingReminderSent = true;
        await donation.save();

        results.whatsappSent.push({ name: donation.name, mobile: donation.mobile, amount: donation.amount });
      } catch (err) {
        results.errors.push({
          channel: "whatsapp",
          name: donation.name,
          mobile: donation.mobile,
          error: err?.response?.data?.message || err.message,
        });
      }
    }

    // --- Email channel ---
    if (!donation.emailPendingReminderSent && donation.email) {
      try {
        await sendPendingPaymentEmail(
          donation.email,
          donation.name,
          donation.amount,
          donation.isRecurring ? "monthly" : "one-time"
        );

        donation.emailPendingReminderSent = true;
        await donation.save();

        results.emailSent.push({ name: donation.name, email: donation.email, amount: donation.amount });
      } catch (err) {
        results.errors.push({
          channel: "email",
          name: donation.name,
          email: donation.email,
          error: err.message,
        });
      }
    }
  }

  console.log(
    `[Pending Reminders] ${results.whatsappSent.length} WhatsApp sent, ` +
    `${results.emailSent.length} email sent, ${results.errors.length} errors.`
  );
  return results;
}

const pendingReminderController = {
  // Manual trigger endpoint (also used by cron)
  triggerPendingReminders: async (req, res) => {
    try {
      const results = await runPendingReminders();
      res.json({ success: true, ...results });
    } catch (error) {
      console.error("Pending reminders error:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  },

  // Preview — see who WOULD get a reminder right now, without sending
  previewPendingReminders: async (req, res) => {
    try {
      const cutoff = new Date(Date.now() - 6 * 60 * 1000);
      const pending = await donationModle.find({
        status: "created",
        createdAt: { $lte: cutoff },
        $or: [
          { whatsappPendingReminderSent: { $ne: true } },
          { emailPendingReminderSent: { $ne: true } },
        ],
      }).select("name mobile email amount createdAt whatsappPendingReminderSent emailPendingReminderSent");

      res.json({ success: true, count: pending.length, pending });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  },
};

module.exports = { pendingReminderController, runPendingReminders };
