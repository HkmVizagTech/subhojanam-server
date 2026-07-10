const { donationModle } = require("../models/donation.model");
const { sendBirthdayWishWhatsapp, sendAnniversaryWishWhatsapp } = require("../services/whatsapp.service");

/**
 * Birthday signal:    `dob` field (recurring every year on that month+day)
 * Anniversary signal: `occasion === "Anniversary"` + `sevaDate` (recurring every year on that month+day)
 *
 * Groups all donations by mobile, checks every record for a matching
 * signal against today's month+day.
 */

function matchesTodayMonthDay(dateStr, todayMonth, todayDate) {
  if (!dateStr) return false;
  const dt = new Date(dateStr);
  if (isNaN(dt.getTime())) return false;
  return dt.getMonth() + 1 === todayMonth && dt.getDate() === todayDate;
}

async function runDailyWishes() {
  const now = new Date();
  const todayMonth = now.getMonth() + 1;
  const todayDate = now.getDate();
  const currentYear = now.getFullYear();

  const results = { birthdaysSent: [], anniversariesSent: [], errors: [] };

  // Pull every donation that carries a relevant signal
  const relevant = await donationModle.find({
    $or: [
      { dob: { $exists: true, $ne: "" } },
      { occasion: "Anniversary", sevaDate: { $exists: true, $ne: "" } },
    ],
  }).sort({ createdAt: -1 });

  // Group by mobile
  const byMobile = {};
  for (const d of relevant) {
    if (!byMobile[d.mobile]) byMobile[d.mobile] = [];
    byMobile[d.mobile].push(d);
  }

  for (const mobile in byMobile) {
    const records = byMobile[mobile];
    const latest = records[0]; // most recent record — for name + wish-tracking flags
    const donorName = latest.name;

    // ---- Birthday: dob field ----
    const isBirthdayToday = records.some(d => matchesTodayMonthDay(d.dob, todayMonth, todayDate));

    if (isBirthdayToday && latest.lastBirthdayWishSentYear !== currentYear) {
      try {
        let phone = mobile.replace(/\D/g, "");
        if (!phone.startsWith("91")) phone = `91${phone}`;
        await sendBirthdayWishWhatsapp(phone, donorName);
        await donationModle.updateMany({ mobile }, { $set: { lastBirthdayWishSentYear: currentYear } });
        results.birthdaysSent.push({ name: donorName, mobile });
      } catch (err) {
        results.errors.push({ type: "birthday", mobile, name: donorName, error: err.message });
      }
    }

    // ---- Anniversary: occasion === "Anniversary" + sevaDate ----
    const isAnniversaryToday = records.some(d =>
      d.occasion === "Anniversary" && matchesTodayMonthDay(d.sevaDate, todayMonth, todayDate)
    );

    if (isAnniversaryToday && latest.lastAnniversaryWishSentYear !== currentYear) {
      try {
        let phone = mobile.replace(/\D/g, "");
        if (!phone.startsWith("91")) phone = `91${phone}`;
        await sendAnniversaryWishWhatsapp(phone, donorName);
        await donationModle.updateMany({ mobile }, { $set: { lastAnniversaryWishSentYear: currentYear } });
        results.anniversariesSent.push({ name: donorName, mobile });
      } catch (err) {
        results.errors.push({ type: "anniversary", mobile, name: donorName, error: err.message });
      }
    }
  }

  console.log(
    `[Daily Wishes] ${results.birthdaysSent.length} birthday, ${results.anniversariesSent.length} anniversary wishes sent. ${results.errors.length} errors.`
  );

  return results;
}

const wishController = {
  triggerDailyWishes: async (req, res) => {
    try {
      const results = await runDailyWishes();
      res.json({ success: true, ...results });
    } catch (error) {
      console.error("Daily wishes error:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  },

  // Preview endpoint — see who WOULD be wished today without sending
  previewTodaysWishes: async (req, res) => {
    try {
      const now = new Date();
      const todayMonth = now.getMonth() + 1;
      const todayDate = now.getDate();
      const currentYear = now.getFullYear();

      const relevant = await donationModle.find({
        $or: [
          { dob: { $exists: true, $ne: "" } },
          { occasion: "Anniversary", sevaDate: { $exists: true, $ne: "" } },
        ],
      }).sort({ createdAt: -1 });

      const byMobile = {};
      for (const d of relevant) {
        if (!byMobile[d.mobile]) byMobile[d.mobile] = [];
        byMobile[d.mobile].push(d);
      }

      const birthdaysToday = [];
      const anniversariesToday = [];

      for (const mobile in byMobile) {
        const records = byMobile[mobile];
        const latest = records[0];

        const isBirthdayToday = records.some(d => matchesTodayMonthDay(d.dob, todayMonth, todayDate));
        if (isBirthdayToday && latest.lastBirthdayWishSentYear !== currentYear) {
          birthdaysToday.push({ name: latest.name, mobile });
        }

        const isAnniversaryToday = records.some(d =>
          d.occasion === "Anniversary" && matchesTodayMonthDay(d.sevaDate, todayMonth, todayDate)
        );
        if (isAnniversaryToday && latest.lastAnniversaryWishSentYear !== currentYear) {
          anniversariesToday.push({ name: latest.name, mobile });
        }
      }

      res.json({ success: true, birthdaysToday, anniversariesToday });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  },
};

module.exports = { wishController, runDailyWishes };
