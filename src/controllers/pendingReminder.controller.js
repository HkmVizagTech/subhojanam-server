const { donationModle } = require("../models/donation.model");
const { sendPendingWhatsapp } = require("../services/whatsapp.service");

/**
 * Finds donations stuck in "created" (payment initiated but never completed)
 * for at least 6 minutes, and sends a one-time WhatsApp reminder nudging
 * them to complete the payment. Marks whatsappPendingReminderSent so the
 * same donation is never reminded twice.
 */
async function runPendingReminders() {
  const cutoff = new Date(Date.now() - 6 * 60 * 1000);

  const pendingDonations = await donationModle.find({
    status: "created",
    createdAt: { $lte: cutoff },
    whatsappPendingReminderSent: { $ne: true },
  });

  const results = { sent: [], errors: [] };

  for (const donation of pendingDonations) {
    try {
      if (!donation.mobile) continue;
      let phone = donation.mobile.replace(/\D/g, "");
      if (!phone.startsWith("91")) phone = `91${phone}`;

      await sendPendingWhatsapp(phone, donation.name, donation.amount);

      donation.whatsappPendingReminderSent = true;
      await donation.save();

      results.sent.push({ name: donation.name, mobile: donation.mobile, amount: donation.amount });
    } catch (err) {
      results.errors.push({
        name: donation.name,
        mobile: donation.mobile,
        error: err?.response?.data?.message || err.message,
      });
    }
  }

  console.log(
    `[Pending Reminders] ${results.sent.length} sent, ${results.errors.length} errors.`
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
        whatsappPendingReminderSent: { $ne: true },
      }).select("name mobile amount createdAt");

      res.json({ success: true, count: pending.length, pending });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  },
};

module.exports = { pendingReminderController, runPendingReminders };
