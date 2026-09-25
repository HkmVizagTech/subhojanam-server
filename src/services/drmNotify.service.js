// Live push to the HKM Vizag DRM (donor relationship manager, a separate
// PostgreSQL/Express app).
//
// Credential: DRM_SYNC_SECRET - this integration's own, NOT the site's
// existing INTERNAL_SECRET (which belongs to the pending-reminders endpoint).
// The same value guards the inbound direction in routes/internal.routes.js. When a transaction completes here, DRM should show
// it immediately rather than waiting for someone to press "import".
//
// SAFETY CONTRACT - this runs inside the live Razorpay webhook path:
//   * It NEVER throws. Every path is caught and logged.
//   * It NEVER blocks a donation. Callers do not await it, and the request
//     carries a hard timeout so a hung DRM can't pin a socket.
//   * If DRM is down, misconfigured, or slow, the payment still completes, the
//     receipt still generates, and WhatsApp still goes out - the only
//     consequence is DRM being briefly stale, which the import button
//     reconciles.
// A failed push is a soft, self-healing failure by design. Do not "improve"
// this by awaiting it or letting it throw.
//
// What it sends: the same snapshot shape DRM's pull API returns, built from
// this one donor's transactions, so DRM runs a single idempotent upsert path
// for both push and pull. Keyed on the normalised mobile and the transaction
// id, so a duplicate push updates rather than duplicates.

const REQUEST_TIMEOUT_MS = 8000;

function normalizeBaseUrl(raw) {
  const trimmed = String(raw || "").trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  const isLocal = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:\d+)?$/i.test(trimmed);
  return `${isLocal ? "http" : "https"}://${trimmed}`;
}

function isConfigured() {
  return Boolean(normalizeBaseUrl(process.env.DRM_API_URL) && process.env.DRM_SYNC_SECRET);
}

// Pushes the donor's current snapshot to DRM for the donation given.
//
// Sends the donor's WHOLE history rather than just this one transaction: this
// site stores the donor's details on each transaction, so a single row would
// let a blank field (a gift made without re-entering a PAN, say) overwrite
// good data DRM already holds. The full set lets DRM's merge rules pick the
// best value per field, exactly as the import does.
async function notifyDrmOfTransaction(donationId, { reason = "transaction_completed" } = {}) {
  try {
    if (!isConfigured()) {
      // Not an error - the DRM integration simply isn't switched on in this
      // environment. Stay quiet so local/dev logs aren't noisy.
      return { ok: false, skipped: true, reason: "not_configured" };
    }

    const { donationModle } = require("../models/donation.model");
    const donation = await donationModle.findById(donationId).lean();
    if (!donation) return { ok: false, skipped: true, reason: "donation_not_found" };
    if (!donation.mobile) return { ok: false, skipped: true, reason: "no_mobile" };

    // Reuse the internal API's own mapping so the push and the pull can never
    // disagree about what a transaction looks like.
    const { internalController, normalizeMobile } = require("../controllers/internal.controller");
    const mobile = normalizeMobile(donation.mobile);
    if (!mobile) return { ok: false, skipped: true, reason: "no_mobile" };

    // Build the snapshot through the same handler DRM's pull uses, by calling
    // it with a minimal fake res. Keeps one code path instead of a second
    // mapping that drifts.
    const snapshot = await new Promise((resolve, reject) => {
      const fakeRes = {
        statusCode: 200,
        status(code) { this.statusCode = code; return this; },
        json(body) {
          if (this.statusCode >= 400) reject(new Error(body && body.message ? body.message : "lookup failed"));
          else resolve(body);
        },
      };
      internalController.getDonorByMobile({ params: { mobile } }, fakeRes).catch(reject);
    });

    if (!snapshot || !snapshot.found) return { ok: false, skipped: true, reason: "donor_not_found" };

    const baseUrl = normalizeBaseUrl(process.env.DRM_API_URL);
    const res = await fetch(`${baseUrl}/api/webhooks/hkmv/donor-updated`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-secret": process.env.DRM_SYNC_SECRET,
      },
      body: JSON.stringify({
        reason,
        site: "annadan",
        triggeredByDonationId: String(donationId),
        found: true,
        donor: snapshot.donor,
        donations: snapshot.donations,
        subscriptions: snapshot.subscriptions,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.warn(`⚠️ DRM push returned ${res.status} for donation ${donationId} (non-fatal):`, body.slice(0, 200));
      return { ok: false, status: res.status };
    }

    return { ok: true };
  } catch (err) {
    // Includes timeouts, DNS failures, DRM being down - all non-fatal.
    console.warn(
      `⚠️ DRM push failed for donation ${donationId} (non-fatal, DRM catches up on next import):`,
      err && err.message ? err.message : err
    );
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
}

// Fire-and-forget wrapper. Call this from the webhook path - it returns
// immediately and can never reject.
function pushToDrm(donationId, opts) {
  try {
    notifyDrmOfTransaction(donationId, opts).catch((e) =>
      console.warn("⚠️ DRM push rejected (non-fatal):", e && e.message ? e.message : e)
    );
  } catch (e) {
    console.warn("⚠️ DRM push could not start (non-fatal):", e && e.message ? e.message : e);
  }
}

module.exports = { notifyDrmOfTransaction, pushToDrm, isConfigured };
