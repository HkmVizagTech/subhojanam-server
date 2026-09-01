const { donationModle } = require("../models/donation.model");
const {
  sendBirthdayWishWhatsapp,
  sendCelebrationWishToSevak,
  sendCelebrationWishToDonor,
  sendMemorialWishToSevak,
  sendMemorialWishToDonor,
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
 * Send a "special day" wish for a single donation record, on behalf of a named honoree (sevak).
 * Works for any occasion (Birthday, Anniversary, Memorial, or any custom text) — routes to the
 * honoree/family contact directly if their mobile is known, else to the donor mentioning the
 * honoree's name. If no honoree was named at all, sends nothing — this is strictly an
 * honoree-acknowledgement feature, not a general occasion reminder.
 *
 * Memorial gets solemn wording via a separate pair of templates — reusing celebratory ("Happy
 * {{occasion}}!") wording for a death anniversary would be inappropriate, and for Memorial the
 * "sevak" contact represents a living family member being notified, not the deceased themselves.
 * Only the literal "Memorial" occasion value triggers this; a custom "Other" occasion (even one
 * typed as e.g. "Death Anniversary") still gets celebratory wording — a known limitation.
 */
async function sendOccasionWish(donation) {
  const donorPhone = normalizePhone(donation.mobile);
  const sevakPhone = normalizePhone(donation.sevakMobile);
  const sevakName = donation.sevakName?.trim();
  const isMemorial = donation.occasion === "Memorial";

  if (sevakPhone && sevakName) {
    if (isMemorial) {
      await sendMemorialWishToSevak(sevakPhone, sevakName);
    } else {
      await sendCelebrationWishToSevak(sevakPhone, sevakName, donation.occasion);
    }
  } else if (sevakName && donorPhone) {
    if (isMemorial) {
      await sendMemorialWishToDonor(donorPhone, donation.name, sevakName);
    } else {
      await sendCelebrationWishToDonor(donorPhone, donation.name, sevakName, donation.occasion);
    }
  }
}

/**
 * Called immediately after a donation is created (from webhook/offline controller).
 * If the seva date is TODAY and an occasion is set → send the honoree wish now, and stamp
 * lastSevakWishSentYear so the daily cron doesn't send a duplicate later the same day.
 */
async function maybeSendSameDayWish(donation) {
  try {
    const now = new Date();
    const todayMonth = now.getMonth() + 1;
    const todayDate = now.getDate();
    const currentYear = now.getFullYear();

    const isOccasionToday = Boolean(donation.occasion?.trim()) &&
      matchesTodayMonthDay(donation.sevaDate, todayMonth, todayDate);

    if (isOccasionToday && donation.lastSevakWishSentYear !== currentYear) {
      await sendOccasionWish(donation);
      await donationModle.findByIdAndUpdate(donation._id, {
        $set: { lastSevakWishSentYear: currentYear },
      });
      console.log(`[Same-day wish] Occasion wish sent for donation ${donation._id}`);
    }
  } catch (err) {
    console.error("[Same-day wish] Error:", err.message);
  }
}

/**
 * Daily cron job — runs at 8 AM IST. Two independent passes:
 *  1. DOB-based birthday nudge (unchanged) — reminds past donors it's their own birthday.
 *  2. Occasion-based honoree wish (generalized) — any occasion + sevaDate match today, deduped
 *     per donation record via lastSevakWishSentYear rather than grouped per donor mobile, so one
 *     donor's unrelated occasions (e.g. a Memorial in June and a Birthday-for-someone-else in
 *     March) don't suppress each other.
 */
async function runDailyWishes() {
  const now = new Date();
  const todayMonth = now.getMonth() + 1;
  const todayDate = now.getDate();
  const currentYear = now.getFullYear();

  const results = { birthdaysSent: [], occasionWishesSent: [], errors: [] };

  // ---- Pass 1: DOB-based birthday nudge (unchanged) ----
  const dobDonations = await donationModle.find({
    dob: { $exists: true, $ne: "" },
  }).sort({ createdAt: -1 });

  const byMobile = {};
  for (const d of dobDonations) {
    if (!byMobile[d.mobile]) byMobile[d.mobile] = [];
    byMobile[d.mobile].push(d);
  }

  for (const mobile in byMobile) {
    const records = byMobile[mobile];
    const latest = records[0];

    const dobMatch = records.find(d => matchesTodayMonthDay(d.dob, todayMonth, todayDate));
    if (dobMatch && latest.lastBirthdayWishSentYear !== currentYear) {
      try {
        const donorPhone = normalizePhone(dobMatch.mobile);
        if (donorPhone) {
          await sendBirthdayWishWhatsapp(donorPhone, dobMatch.name);
          await donationModle.updateMany({ mobile }, { $set: { lastBirthdayWishSentYear: currentYear } });
          results.birthdaysSent.push({ name: latest.name, mobile, via: "dob" });
        }
      } catch (err) {
        results.errors.push({ type: "birthday-dob", mobile, error: err.message });
      }
    }
  }

  // ---- Pass 2: Occasion-based honoree wish — any occasion, per-record dedup ----
  const occasionDonations = await donationModle.find({
    occasion: { $exists: true, $ne: "" },
    sevaDate: { $exists: true, $ne: "" },
  });

  for (const donation of occasionDonations) {
    const isOccasionToday = matchesTodayMonthDay(donation.sevaDate, todayMonth, todayDate);
    if (isOccasionToday && donation.lastSevakWishSentYear !== currentYear) {
      try {
        await sendOccasionWish(donation);
        await donationModle.findByIdAndUpdate(donation._id, {
          $set: { lastSevakWishSentYear: currentYear },
        });
        results.occasionWishesSent.push({
          name: donation.name,
          mobile: donation.mobile,
          occasion: donation.occasion,
          sevakName: donation.sevakName,
          sevakMobile: donation.sevakMobile,
        });
      } catch (err) {
        results.errors.push({ type: "occasion", donationId: donation._id, error: err.message });
      }
    }
  }

  console.log(
    `[Daily Wishes] ${results.birthdaysSent.length} birthday nudges, ` +
    `${results.occasionWishesSent.length} occasion wishes sent. ` +
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

      // ---- DOB-based birthday nudge preview (unchanged) ----
      const dobDonations = await donationModle.find({
        dob: { $exists: true, $ne: "" },
      }).sort({ createdAt: -1 });

      const byMobile = {};
      for (const d of dobDonations) {
        if (!byMobile[d.mobile]) byMobile[d.mobile] = [];
        byMobile[d.mobile].push(d);
      }

      const birthdaysToday = [];
      for (const mobile in byMobile) {
        const records = byMobile[mobile];
        const latest = records[0];
        const dobMatch = records.find(d => matchesTodayMonthDay(d.dob, todayMonth, todayDate));
        if (dobMatch && latest.lastBirthdayWishSentYear !== currentYear) {
          birthdaysToday.push({ donorName: latest.name, mobile, via: "dob" });
        }
      }

      // ---- Occasion-based honoree wish preview (generalized, per-record) ----
      const occasionDonations = await donationModle.find({
        occasion: { $exists: true, $ne: "" },
        sevaDate: { $exists: true, $ne: "" },
      });

      const occasionWishesToday = occasionDonations
        .filter(d =>
          matchesTodayMonthDay(d.sevaDate, todayMonth, todayDate) &&
          d.lastSevakWishSentYear !== currentYear
        )
        .map(d => ({
          donorName: d.name,
          mobile: d.mobile,
          occasion: d.occasion,
          sevakName: d.sevakName || null,
          messageGoesTo: d.sevakMobile && d.sevakName
            ? `sevak (${d.sevakMobile})`
            : d.sevakName
              ? `donor (${d.mobile})`
              : "nobody (no honoree named)",
        }));

      res.json({ success: true, birthdaysToday, occasionWishesToday });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  },
};

module.exports = { wishController, runDailyWishes, maybeSendSameDayWish };
