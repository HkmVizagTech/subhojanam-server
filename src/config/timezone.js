// Process timezone — must be required before anything that touches a Date.
//
// Cloud Run runs containers on UTC and nothing in this service set TZ, so every
// JavaScript Date in the process reported a UTC calendar day. The temple is in
// Visakhapatnam and a UTC day runs 05:30 IST to 05:30 IST, which meant every
// donation taken between midnight and 5:30am IST was counted, filtered,
// exported and receipted as the PREVIOUS day.
//
// This is set in code rather than as a Cloud Run environment variable because a
// variable can be dropped from a new revision by accident, and the symptom of
// that is not an error — it is silently wrong dates on 80G certificates and on
// the admin dashboard, which nobody notices until an auditor does.
//
// An existing TZ wins, so a test can still run the process under another zone
// with `TZ=UTC node ...`.
if (!process.env.TZ) {
  process.env.TZ = "Asia/Kolkata";
}

const IST = "Asia/Kolkata";

// The UTC offset India has used since 1945 and has no DST, so a literal offset
// is safe here. It is used only for anchoring date-only strings, where an IANA
// name cannot be expressed in an ISO-8601 string.
const IST_OFFSET = "+05:30";

// A bare calendar date with no time and no zone, e.g. "2026-10-01".
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Start of an IST calendar day, as an instant.
 *
 * `new Date("2026-10-01")` is specified to parse a date-only string as UTC
 * midnight, and setting TZ does not change that — it stays 05:30 IST, so a
 * range filter built from it silently dropped the first five and a half hours
 * of the start day. Anything that already carries a time or a zone is passed
 * through untouched.
 */
function istDayStart(value) {
  if (value instanceof Date) return value;
  if (typeof value === "string" && DATE_ONLY.test(value)) {
    return new Date(`${value}T00:00:00.000${IST_OFFSET}`);
  }
  return new Date(value);
}

/**
 * End of an IST calendar day (23:59:59.999 IST), as an instant.
 */
function istDayEnd(value) {
  if (typeof value === "string" && DATE_ONLY.test(value)) {
    return new Date(`${value}T23:59:59.999${IST_OFFSET}`);
  }
  const d = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  d.setHours(23, 59, 59, 999);
  return d;
}

/**
 * An instant rendered as the IST calendar date, dd/mm/yyyy.
 * Pinned to IST explicitly rather than leaning on TZ, because the only callers
 * are legal documents.
 */
function istDateDDMMYYYY(value) {
  const d = value instanceof Date ? value : new Date(value);
  return d.toLocaleDateString("en-GB", { timeZone: IST });
}

/**
 * The IST calendar year of an instant, as a number.
 */
function istYear(value) {
  const d = value instanceof Date ? value : new Date(value);
  const year = new Intl.DateTimeFormat("en-US", {
    timeZone: IST,
    year: "numeric",
  })
    .formatToParts(d)
    .find((p) => p.type === "year").value;
  return Number(year);
}

module.exports = {
  IST,
  IST_OFFSET,
  istDayStart,
  istDayEnd,
  istDateDDMMYYYY,
  istYear,
};
