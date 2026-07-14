const { donationModle } = require("../models/donation.model");
const {
  sendBirthdayWishWhatsapp,
  sendAnniversaryWishWhatsapp,
  sendBirthdayWishToSevak,
  sendBirthdayWishToDonor,
  sendAnniversaryWishToSevak,
  sendAnniversaryWishToDonor,
} = require("../services/whatsapp.service");

function matchesTodayMonthDay(dateStr, todayMonth, todayDate) {
  if (!dateStr) return false;
  const dt = new Date(dateStr);
  if (isNaN(dt.getTime())) return false;
  return dt.getMonth() + 1 === todayMonth && dt.getDate() === todayDate;
}

function normalizePhone(mobile) {
  if (!mobile) return null;
  const digits = String(mobile).replace(/\D/g, "");
  if (digits.length < 10) return null;
  return digits.startsWith("91") ? digits : `91${digits}`;
}

/**
 * Send a birthday wish for a single donation record.
 * Routes to sevak if sevakMobile is present, else to donor.
 */
async function sendBirthdayWish(donation) {
  const donorPhone = normalizePhone(donation.mobile);
  const sevakPhone = normalizePhone(donation.sevakMobile);
  const sevakName = donation.sevakName?.trim();

  if (sevakPhone && sevakName) {
    // Route to the honoree directly
    await sendBirthdayWishToSevak(sevakPhone, sevakName);
  } else if (sevakName && donorPhone) {
    // No honoree mobile — send to donor mentioning sevak
    await sendBirthdayWishToDonor(donorPhone, donation.name, sevakName);
  } else if (donorPhone) {
    // DOB-based — wish goes to donor
    await sendBirthdayWishWhatsapp(donorPhone, donation.name);
  }
}

/**
 * Send an anniversary wish for a single donation record.
 */
async function sendAnniversaryWish(donation) {
  const donorPhone = normalizePhone(donation.mobile);
  const sevakPhone = normalizePhone(donation.sevakMobile);
  const sevakName = donation.sevakName?.trim();

  if (sevakPhone && sevakName) {
    await sendAnniversaryWishToSevak(sevakPhone, sevakName);
  } else if (sevakName && donorPhone) {
    await sendAnniversaryWishToDonor(donorPhone, donation.name, sevakName);
  } else if (donorPhone) {
    await sendAnniversaryWishWhatsapp(donorPhone, donation.name);
  }
}

/**
 * Called immediately after a donation is created (from webhook/offline controller).
 * If the seva date is TODAY and occasion is Birthday/Anniversary → send wish now.
 * This handles "donated on the occasion day itself".
 */
async function maybeSendSameDayWish(donation) {
  try {
    const now = new Date();
    const todayMonth = now.getMonth() + 1;
    const todayDate = now.getDate();

    const isBirthdayOccasion = donation.occasion === "Birthday" &&
      matchesTodayMonthDay(donation.sevaDate, todayMonth, todayDate);

    const isAnniversaryOccasion = donation.occasion === "Anniversary" &&
      matchesTodayMonthDay(donation.sevaDate, todayMonth, todayDate);

    if (isBirthdayOccasion) {
      await sendBirthdayWish(donation);
      console.log(`[Same-day wish] Birthday wish sent for donation ${donation._id}`);
    } else if (isAnniversaryOccasion) {
      await sendAnniversaryWish(donation);
      console.log(`[Same-day wish] Anniversary wish sent for donation ${donation._id}`);
    }
  } catch (err) {
    console.error("[Same-day wish] Error:", err.message);
  }
}

/**
 * Daily cron job — runs at 8 AM IST.
 * Checks all donations for birthday/anniversary matches today.
 * Uses sevakMobile routing for occasion-based donations.
 */
async function runDailyWishes() {
  const now = new Date();
  const todayMonth = now.getMonth() + 1;
  const todayDate = now.getDate();
  const currentYear = now.getFullYear();

  const results = { birthdaysSent: [], anniversariesSent: [], errors: [] };

  const relevant = await donationModle.find({
    $or: [
      { dob: { $exists: true, $ne: "" } },
      { occasion: "Birthday",     sevaDate: { $exists: true, $ne: "" } },
      { occasion: "Anniversary",  sevaDate: { $exists: true, $ne: "" } },
    ],
  }).sort({ createdAt: -1 });

  // Group by donor mobile so each donor gets one wish per occasion per year
  const byMobile = {};
  for (const d of relevant) {
    if (!byMobile[d.mobile]) byMobile[d.mobile] = [];
    byMobile[d.mobile].push(d);
  }

  for (const mobile in byMobile) {
    const records = byMobile[mobile];
    const latest = records[0]; // most recent record holds the latest sevakMobile etc.

    // ---- Birthday (DOB field) ----
    const dobMatch = records.find(d => matchesTodayMonthDay(d.dob, todayMonth, todayDate));
    if (dobMatch && latest.lastBirthdayWishSentYear !== currentYear) {
      try {
        await sendBirthdayWish(dobMatch);
        await donationModle.updateMany({ mobile }, { $set: { lastBirthdayWishSentYear: currentYear } });
        results.birthdaysSent.push({ name: latest.name, mobile, via: "dob" });
      } catch (err) {
        results.errors.push({ type: "birthday", mobile, error: err.message });
      }
    }

    // ---- Birthday (occasion=Birthday + sevaDate) ----
    const birthdaySevaMatch = records.find(d =>
      d.occasion === "Birthday" && matchesTodayMonthDay(d.sevaDate, todayMonth, todayDate)
    );
    if (birthdaySevaMatch && latest.lastBirthdayWishSentYear !== currentYear) {
      try {
        await sendBirthdayWish(birthdaySevaMatch);
        await donationModle.updateMany({ mobile }, { $set: { lastBirthdayWishSentYear: currentYear } });
        results.birthdaysSent.push({
          name: latest.name, mobile,
          via: "sevaDate",
          sevakName: birthdaySevaMatch.sevakName,
          sevakMobile: birthdaySevaMatch.sevakMobile,
        });
      } catch (err) {
        results.errors.push({ type: "birthday-seva", mobile, error: err.message });
      }
    }

    // ---- Anniversary (occasion=Anniversary + sevaDate) ----
    const anniversarySevaMatch = records.find(d =>
      d.occasion === "Anniversary" && matchesTodayMonthDay(d.sevaDate, todayMonth, todayDate)
    );
    if (anniversarySevaMatch && latest.lastAnniversaryWishSentYear !== currentYear) {
      try {
        await sendAnniversaryWish(anniversarySevaMatch);
        await donationModle.updateMany({ mobile }, { $set: { lastAnniversaryWishSentYear: currentYear } });
        results.anniversariesSent.push({
          name: latest.name, mobile,
          via: "sevaDate",
          sevakName: anniversarySevaMatch.sevakName,
          sevakMobile: anniversarySevaMatch.sevakMobile,
        });
      } catch (err) {
        results.errors.push({ type: "anniversary-seva", mobile, error: err.message });
      }
    }
  }

  console.log(
    `[Daily Wishes] ${results.birthdaysSent.length} birthday, ` +
    `${results.anniversariesSent.length} anniversary wishes sent. ` +
    `${results.errors.length} errors.`
  );
  return results;
}

const wishController = {
  triggerDailyWishes: async (req, res) => {
    try {
      const results = await runDailyWishes();
      res.json({ success: true, ...results });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  },

  previewTodaysWishes: async (req, res) => {
    try {
      const now = new Date();
      const todayMonth = now.getMonth() + 1;
      const todayDate = now.getDate();
      const currentYear = now.getFullYear();

      const relevant = await donationModle.find({
        $or: [
          { dob: { $exists: true, $ne: "" } },
          { occasion: "Birthday",    sevaDate: { $exists: true, $ne: "" } },
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

        const dobMatch = records.find(d => matchesTodayMonthDay(d.dob, todayMonth, todayDate));
        const birthdaySevaMatch = records.find(d =>
          d.occasion === "Birthday" && matchesTodayMonthDay(d.sevaDate, todayMonth, todayDate)
        );

        if ((dobMatch || birthdaySevaMatch) && latest.lastBirthdayWishSentYear !== currentYear) {
          const match = birthdaySevaMatch || dobMatch;
          birthdaysToday.push({
            donorName: latest.name, mobile,
            sevakName: match.sevakName || null,
            messageGoesTo: match.sevakMobile ? `sevak (${match.sevakMobile})` : `donor (${mobile})`,
          });
        }

        const anniversarySevaMatch = records.find(d =>
          d.occasion === "Anniversary" && matchesTodayMonthDay(d.sevaDate, todayMonth, todayDate)
        );
        if (anniversarySevaMatch && latest.lastAnniversaryWishSentYear !== currentYear) {
          anniversariesToday.push({
            donorName: latest.name, mobile,
            sevakName: anniversarySevaMatch.sevakName || null,
            messageGoesTo: anniversarySevaMatch.sevakMobile
              ? `sevak (${anniversarySevaMatch.sevakMobile})`
              : `donor (${mobile})`,
          });
        }
      }

      res.json({ success: true, birthdaysToday, anniversariesToday });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  },
};

module.exports = { wishController, runDailyWishes, maybeSendSameDayWish };
