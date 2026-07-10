const { donationModle } = require("../models/donation.model");
const { sendBirthdayWishWhatsapp, sendAnniversaryWishWhatsapp } = require("../services/whatsapp.service");

/**
 * A donor's birthday can be signalled two ways:
 *   1. Dedicated `dob` field
 *   2. `occasion === "Birthday"` + `sevaDate` (recurring annually on that date)
 *
 * Anniversary similarly via `anniversaryDate` OR `occasion === "Anniversary"` + `sevaDate`.
 *
 * This groups all donations by mobile, collects every date-signal across
 * all of that donor's records, and checks if any of them match today's month+day.
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

  // Pull every donation that carries ANY relevant signal
  const relevant = await donationModle.find({
    $or: [
      { dob: { $exists: true, $ne: "" } },
      { anniversaryDate: { $exists: true, $ne: "" } },
      { occasion: { $in: ["Birthday", "Anniversary"] } },
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

    // ---- Check birthday signal across ALL this donor's records ----
    const isBirthdayToday = records.some(d =>
      matchesTodayMonthDay(d.dob, todayMonth, todayDate) ||
      (d.occasion === "Birthday" && matchesTodayMonthDay(d.sevaDate, todayMonth, todayDate))
    );

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

    // ---- Check anniversary signal across ALL this donor's records ----
    const isAnniversaryToday = records.some(d =>
      matchesTodayMonthDay(d.anniversaryDate, todayMonth, todayDate) ||
      (d.occasion === "Anniversary" && matchesTodayMonthDay(d.sevaDate, todayMonth, todayDate))
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
          { anniversaryDate: { $exists: true, $ne: "" } },
          { occasion: { $in: ["Birthday", "Anniversary"] } },
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

        const isBirthdayToday = records.some(d =>
          matchesTodayMonthDay(d.dob, todayMonth, todayDate) ||
          (d.occasion === "Birthday" && matchesTodayMonthDay(d.sevaDate, todayMonth, todayDate))
        );
        if (isBirthdayToday && latest.lastBirthdayWishSentYear !== currentYear) {
          const source = records.find(d => matchesTodayMonthDay(d.dob, todayMonth, todayDate));
          birthdaysToday.push({
            name: latest.name, mobile,
            matchedVia: source ? "dob" : "occasion+sevaDate",
          });
        }

        const isAnniversaryToday = records.some(d =>
          matchesTodayMonthDay(d.anniversaryDate, todayMonth, todayDate) ||
          (d.occasion === "Anniversary" && matchesTodayMonthDay(d.sevaDate, todayMonth, todayDate))
        );
        if (isAnniversaryToday && latest.lastAnniversaryWishSentYear !== currentYear) {
          const source = records.find(d => matchesTodayMonthDay(d.anniversaryDate, todayMonth, todayDate));
          anniversariesToday.push({
            name: latest.name, mobile,
            matchedVia: source ? "anniversaryDate" : "occasion+sevaDate",
          });
        }
      }

      res.json({ success: true, birthdaysToday, anniversariesToday });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  },
};

module.exports = { wishController, runDailyWishes };
