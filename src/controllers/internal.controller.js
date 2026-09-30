const { donationModle } = require("../models/donation.model");

// Server-to-server API for the HKM Vizag DRM (donor relationship manager, a
// separate PostgreSQL/Express app).
//
// DESIGN NOTE - why this serves transactions, not donors:
// This site has no donor collection; donor details are denormalised onto every
// donation. An earlier version of this file grouped donations into donors here
// with an aggregation ($group + $push: "$$ROOT" over the whole collection).
// That put the entire donations collection through a server-side in-memory
// stage on every import page - real load on a live donation site, and liable
// to hit MongoDB's 100MB per-stage limit once the collection is large.
//
// So this file does the cheap thing instead: hand DRM a plain, cursor-paged
// feed of transactions, mapped one document at a time with no cross-document
// work. DRM already keys people by normalised phone and donations by external
// reference, so grouping falls out of its own upsert for free. This site does
// nothing but an indexed range scan.

const normalizeMobile = (m) => String(m || "").replace(/[\s+]/g, "").replace(/^91(?=\d{10}$)/, "");

// Common spellings of one number, so the lookup can try an equality match
// (index-friendly) before falling back to a scan.
function mobileCandidates(mobile) {
  const m = normalizeMobile(mobile);
  if (!m) return [];
  return [
    m,
    `91${m}`,
    `+91${m}`,
    `+91 ${m}`,
    `91 ${m}`,
    `+91-${m}`,
    `0${m}`,
  ];
}

// Finds every transaction belonging to one number.
//
// Two-step on purpose. The $in of literal spellings is index-friendly and
// covers the overwhelming majority of rows, but numbers here are free text and
// turn up with spaces, dashes and prefixes in combinations no fixed list can
// enumerate - a donation stored as "+91 97777 00123" matches nothing in the
// list. So when the fast path finds nothing, fall back to a digits-only
// trailing match, which is correct but scans.
//
// The fallback firing is not an error, but it IS slower, so it logs - if it
// starts showing up constantly, an index on `mobile` (and tidier storage at
// write time) is worth doing.
async function findDonationsForMobile(mobile) {
  const m = normalizeMobile(mobile);
  if (!m) return [];

  const fast = await donationModle
    .find({ mobile: { $in: mobileCandidates(m) } })
    .sort({ createdAt: -1 })
    .lean();
  if (fast.length) return fast;

  console.log(`[internal] mobile ${m}: no exact-spelling match, falling back to scan`);
  // Tolerates any separators: match the last 10 digits regardless of what sits
  // between them.
  const loose = m.split("").join("[^0-9]*");
  return donationModle
    .find({ mobile: { $regex: `${loose}$` } })
    .sort({ createdAt: -1 })
    .lean();
}

// What counts as money actually received: "paid" only.
//
// "completed" is NOT a payment on this site - the subscription.completed
// webhook sets it when a recurring plan reaches the end of its term, so
// counting it would treat a subscription ending as a donation. The other
// statuses (created/pending/halted/cancelled/active) are attempts or
// subscription lifecycle states, not money.
//
// KNOWN EDGE: subscription.completed does findOneAndUpdate({subscriptionId})
// with no sort, so it flips ONE already-paid donation row from "paid" to
// "completed". That row stops being counted here. It affects at most one
// record per finished subscription; widening this list is the wrong fix
// (it would pull in genuine non-payments), so if it matters the cleaner
// answer is for that webhook to write the status on a subscription record
// rather than onto a payment row.
const CONFIRMED_STATUSES = ["paid"];

function pagePathFrom(url) {
  if (!url) return null;
  try {
    return new URL(url).pathname || "/";
  } catch {
    return String(url).split("?")[0] || null;
  }
}

// Prasadam can go to a different address than the donor's own; "same" means
// reuse the billing address fields.
function prasadamAddressOf(d) {
  if (d.prasadamAddressOption === "different") {
    const parts = [d.prasadamAddress, d.prasadamCity, d.prasadamState, d.prasadamPincode].filter(Boolean);
    return parts.length ? { street: parts.join(", ") } : null;
  }
  const parts = [d.address, d.city, d.state, d.pincode].filter(Boolean);
  return parts.length ? { street: parts.join(", ") } : null;
}

// Translates this site's status into the vocabulary DRM counts by.
//
// DRM treats exactly "completed" as money received. This site ALSO has a
// status literally called "completed" that means the opposite - a subscription
// reaching the end of its term - so passing it through unchanged would make
// DRM count a subscription ending as a donation. It is renamed here so the two
// meanings can never collide.
function mapStatus(status) {
  if (CONFIRMED_STATUSES.includes(status)) return "completed";
  if (status === "completed") return "subscription_ended";
  return status;
}

function mapDonation(d) {
  return {
    externalId: String(d._id),
    amount: d.amount,
    type: d.occasion || "Annadan Seva",
    status: mapStatus(d.status),
    createdAt: d.createdAt,
    isRecurring: !!d.isRecurring,
    subscriptionId: d.subscriptionId || null,
    receiptNumber: d.receiptNumber || null,
    receiptIssuedAt: d.receiptGeneratedAt || null,
    sourceSite: "annadan",
    // This site is a single donation page with no sub-pages, so this is
    // effectively always "/". Carried anyway so DRM's per-page reporting has a
    // real value rather than a null it has to special-case.
    sourcePage: pagePathFrom(d.pageUrl) || "/",
    campaign: (d.utm && d.utm.campaign) || null,
    utm: d.utm
      ? { source: d.utm.source || null, medium: d.utm.medium || null, campaign: d.utm.campaign || null }
      : null,
    paymentRef: d.razorpayPaymentId || d.offlineRefNo || null,
    prasadam: d.mahaprasadam
      ? {
          // This site tracks only pending/delivered; DRM's richer status set
          // maps cleanly onto those two.
          status: d.prasadamDeliveryStatus === "delivered" ? "delivered" : "pending",
          courierName: null,
          trackingNumber: d.prasadamTrackingNumber || null,
          dispatchedAt: null,
          deliveredAt: d.prasadamDeliveredAt || null,
          address: prasadamAddressOf(d),
        }
      : null,
  };
}

// The donor half of a transaction. DRM merges these across transactions that
// share a normalised mobile - it does not need this site to do it.
function mapDonorOf(d) {
  const mobile = normalizeMobile(d.mobile);
  const hasAddress = d.address || d.city || d.state || d.pincode;
  return {
    externalId: `annadan:${mobile}`,
    donorId: d.donorNumber || null,
    name: d.name || `Donor ${mobile}`,
    mobile,
    email: d.email || null,
    panNumber: d.panNumber || null,
    savedAddress: hasAddress
      ? { street: d.address || "", city: d.city || "", state: d.state || "", pincode: d.pincode || "" }
      : null,
    donorSince: d.createdAt,
    sourceSite: "annadan",
  };
}

function mapSubscriptionOf(d) {
  if (!d.isRecurring || !d.subscriptionId) return null;
  return {
    subscriptionId: d.subscriptionId,
    sevaName: d.occasion || "Monthly Annadan Seva",
    amount: d.amount,
    status: d.status === "cancelled" || d.status === "halted" ? "cancelled" : "active",
    startedAt: d.createdAt,
    lastChargedAt: CONFIRMED_STATUSES.includes(d.status) ? d.createdAt : null,
    chargeCount: CONFIRMED_STATUSES.includes(d.status) ? 1 : 0,
  };
}

// How long after a manual resend another one is refused. Long enough that a
// double-click or an automatic retry can't send the donor two WhatsApp
// messages; short enough that a genuine second attempt isn't blocked for long.
const RESEND_COOLDOWN_MS = 2 * 60 * 1000;

// Regenerating a receipt must NEVER mint a new number.
//
// receipt.service allocates a LOCAL receipt number and increments the global
// counter whenever it is called without a DCC response - so calling it on a
// donation that hasn't synced would burn a number from the sequence, stamp
// receiptGeneratedAt, and make the Razorpay webhook's
// `if (donation.receiptGeneratedAt) return "Already processed"` guard skip DCC
// sync and WhatsApp for good. DCC sync is mandatory, so these endpoints refuse
// outright rather than generating anything.
//
// Returns null when the donation isn't ready; the caller turns that into a 400.
function receiptApiResponseFor(donation) {
  if (!donation.receiptNumber) return null;
  // Carry the existing number through, so receipt.service takes the
  // "use the API receipt number" branch and never touches the counter.
  return { ...(donation.externalApiResponse || {}), ReceiptNumber: donation.receiptNumber };
}

// receipt.service also rewrites receiptGeneratedAt on every call. Reproducing a
// receipt must not change when it was originally issued, so restore it.
async function regenerateWithoutSideEffects(donation) {
  const apiResp = receiptApiResponseFor(donation);
  if (!apiResp) return null;

  const originalGeneratedAt = donation.receiptGeneratedAt;
  const { generateReceipt } = require("../services/receipt.service");
  const filePath = await generateReceipt(donation, apiResp);

  if (originalGeneratedAt) {
    await donationModle.findByIdAndUpdate(donation._id, {
      $set: { receiptGeneratedAt: originalGeneratedAt },
    });
  }
  return filePath;
}

const internalController = {
  // GET /api/internal/transactions?after=<objectId>&limit=200
  //
  // Cursor-paged feed of raw transactions, oldest first. Cursor rather than
  // skip: skip() walks and discards every preceding document, so deep pages of
  // a large collection get progressively more expensive, while `_id > after`
  // is a pure index range scan at constant cost. _id also embeds a timestamp,
  // so ascending _id is effectively chronological - which means DRM processes
  // a subscription's charges in order and the newest one wins.
  //
  // Each document is mapped on its own. No $group, no $push, no cross-document
  // work - this endpoint must stay cheap enough to run against production
  // while donors are using the site.
  listTransactions: async (req, res) => {
    try {
      const limit = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 200));
      const after = req.query.after;

      const filter = {};
      if (after) {
        const mongoose = require("mongoose");
        if (!mongoose.Types.ObjectId.isValid(after)) {
          return res.status(400).json({ success: false, message: "Invalid `after` cursor" });
        }
        filter._id = { $gt: new mongoose.Types.ObjectId(after) };
      }

      const docs = await donationModle.find(filter).sort({ _id: 1 }).limit(limit).lean();

      // estimatedDocumentCount reads collection metadata instead of counting
      // documents - it's approximate, which is fine for a progress figure, and
      // it costs the site nothing.
      const total = await donationModle.estimatedDocumentCount();

      res.json({
        success: true,
        limit,
        total,
        returned: docs.length,
        hasMore: docs.length === limit,
        nextCursor: docs.length ? String(docs[docs.length - 1]._id) : null,
        transactions: docs.map((d) => ({
          donor: mapDonorOf(d),
          donation: mapDonation(d),
          subscription: mapSubscriptionOf(d),
        })),
      });
    } catch (err) {
      console.error("internal.listTransactions error:", err);
      res.status(500).json({ success: false, message: "Server error" });
    }
  },

  // GET /api/internal/donors/by-mobile/:mobile
  //
  // One donor's full history, for DRM's per-donor "Sync" button. Matches on a
  // set of candidate spellings rather than a trailing regex, so it can use an
  // index on `mobile` if one exists. NOTE: this model currently indexes only
  // razorpayOrderId, razorpayPaymentId and receiptGeneratedAt - adding an
  // index on `mobile` would make this lookup fast, but that's a change to a
  // live collection, so it is deliberately left for you to decide.
  getDonorByMobile: async (req, res) => {
    try {
      const mobile = normalizeMobile(req.params.mobile);
      if (!mobile) return res.status(400).json({ success: false, message: "Mobile number required" });

      const donations = await findDonationsForMobile(mobile);

      if (!donations.length) return res.json({ success: true, found: false });

      // Freshest contact details win; PAN/address taken from whichever
      // transaction actually carries them.
      const latest = donations[0];
      const withPan = donations.find((d) => d.panNumber) || latest;
      const withAddress = donations.find((d) => d.address) || latest;
      const oldest = donations[donations.length - 1];

      const donor = mapDonorOf({ ...latest, panNumber: withPan.panNumber, address: withAddress.address,
        city: withAddress.city, state: withAddress.state, pincode: withAddress.pincode,
        createdAt: oldest.createdAt });

      const subs = new Map();
      for (const d of donations) {
        const s = mapSubscriptionOf(d);
        if (!s) continue;
        const existing = subs.get(s.subscriptionId);
        if (!existing) { subs.set(s.subscriptionId, s); continue; }
        existing.chargeCount += s.chargeCount;
        if (s.lastChargedAt && (!existing.lastChargedAt || s.lastChargedAt > existing.lastChargedAt)) {
          existing.lastChargedAt = s.lastChargedAt;
        }
        if (s.startedAt < existing.startedAt) existing.startedAt = s.startedAt;
      }

      res.json({
        success: true,
        found: true,
        donor,
        donations: donations.map(mapDonation),
        subscriptions: Array.from(subs.values()),
      });
    } catch (err) {
      console.error("internal.getDonorByMobile error:", err);
      res.status(500).json({ success: false, message: "Server error" });
    }
  },


  // POST /api/internal/drm/donations/offline
  //
  // An offline donation (cash, cheque, UPI, bank transfer) entered in DRM
  // rather than on this site's own admin screen.
  //
  // Hands straight to offlineDonationController.createOfflineDonation - the
  // same path this site's admin form uses - so DCC is called, the receipt is
  // generated and WhatsApp goes out exactly as they already do. DRM never mints
  // a receipt number; this site stays the only place that does.
  //
  // Worth knowing about the path this delegates to: if the DCC call fails it
  // DELETES the donation it just created and returns 500, deliberately, so
  // there is never a stored gift without a receipt behind it. DRM therefore
  // treats a failure here as "nothing happened" and shows the error, rather
  // than recording a half-entry to chase later.
  createOfflineDonation: async (req, res) => {
    const { offlineDonationController } = require("./offline.donation.controller");

    const enteredBy = req.body?.enteredByName
      ? `Entered in DRM by ${String(req.body.enteredByName).slice(0, 80)}`
      : "Entered in DRM";

    const fakeReq = {
      body: {
        ...req.body,
        occasion: req.body?.occasion || undefined,
        // Keep the provenance visible on this site's own records too.
        sevakName: req.body?.sevakName || undefined,
        manualEntryNote: enteredBy,
      },
    };

    return offlineDonationController.createOfflineDonation(fakeReq, res);
  },

  // PUT /api/internal/drm/donations/:id/prasadam-status
  //
  // Temple staff now work the prasadam dispatch list in DRM, so what they mark
  // there has to land here too - otherwise this site's Prasadam tab keeps
  // listing delivered boxes as pending and someone re-couriers them.
  //
  // NOT delegated to prasadamController.markDelivered, deliberately, for two
  // reasons. First, that handler SENDS THE DONOR A WHATSAPP on every call, and
  // DRM's first use of this will be catching up a backlog of already-delivered
  // boxes - that would be thousands of "your prasadam is on its way" messages
  // for parcels that arrived weeks ago. Second, it only knows how to say
  // "delivered", and DRM also needs to record a tracking number while a box is
  // still in transit. So this writes the same fields directly, and notifying is
  // opt-in rather than automatic.
  //
  // WHAT THIS SITE CAN AND CANNOT RECORD: prasadamDeliveryStatus is only
  // pending | delivered. DRM's "shipped" has no equivalent here, so a shipped
  // box stays pending with its tracking number filled in - the honest
  // representation, rather than a silent upgrade to delivered. "cancelled" has
  // no equivalent either; instead of inventing one, this reports back that it
  // was not applied, and DRM records that the two sides differ on that row.
  updatePrasadamStatus: async (req, res) => {
    try {
      const incoming = String(req.body?.status || "").toLowerCase();
      if (!["pending", "shipped", "delivered", "cancelled"].includes(incoming)) {
        return res.status(400).json({
          success: false,
          message: "status must be one of: pending, shipped, delivered, cancelled",
        });
      }

      const donation = await donationModle.findById(req.params.id);
      if (!donation) return res.status(404).json({ success: false, message: "Donation not found" });
      if (!donation.mahaprasadam) {
        return res.status(400).json({
          success: false,
          message: "This donation has no mahaprasadam request to track.",
        });
      }

      if (req.body?.trackingNumber !== undefined) {
        donation.prasadamTrackingNumber = String(req.body.trackingNumber || "").trim();
      }

      let applied = true;
      let note = null;

      if (incoming === "delivered") {
        donation.prasadamDeliveryStatus = "delivered";
        // Prefer the time DRM recorded the delivery over the time this request
        // happened to arrive: a backlog upload is marking last week's work.
        const when = req.body?.deliveredAt ? new Date(req.body.deliveredAt) : new Date();
        donation.prasadamDeliveredAt = Number.isNaN(when.getTime()) ? new Date() : when;
      } else if (incoming === "pending" || incoming === "shipped") {
        donation.prasadamDeliveryStatus = "pending";
        donation.prasadamDeliveredAt = undefined;
        if (incoming === "shipped") {
          note = "This site has no 'shipped' state; recorded as pending with the tracking number.";
        }
      } else {
        applied = false;
        note = "This site cannot record a cancelled prasadam request; left unchanged.";
      }

      // Opt-in, and off by default. See the note above about the backlog.
      let notified = false;
      if (applied && incoming === "delivered" && req.body?.notify === true) {
        try {
          // Required here rather than at the top of the file: this controller is
          // loaded on every request path, and the WhatsApp service pulls in
          // provider config that only this one branch needs.
          const { sendPrasadamDispatchWhatsapp } = require("../services/whatsapp.service");
          const useDonorAddress = donation.certificate && donation.prasadamAddressOption !== "different";
          const recipientMobile = useDonorAddress ? donation.mobile : donation.prasadamMobile || donation.mobile;
          const recipientName = useDonorAddress ? donation.name : donation.prasadamName || donation.name;
          let phone = String(recipientMobile || "").replace(/\D/g, "");
          if (phone && !phone.startsWith("91")) phone = `91${phone}`;
          if (phone) {
            await sendPrasadamDispatchWhatsapp(phone, recipientName, donation.prasadamTrackingNumber || "");
            donation.prasadamWhatsappSentAt = new Date();
            notified = true;
          }
        } catch (waErr) {
          // A failed message must not fail the status write: the delivery
          // really did happen, and having DRM retry would re-save the same row.
          console.error(`DRM prasadam WhatsApp failed for ${req.params.id}:`, waErr.message);
        }
      }

      await donation.save();

      return res.status(200).json({
        success: true,
        applied,
        notified,
        status: donation.prasadamDeliveryStatus,
        message: note || `Prasadam request marked ${donation.prasadamDeliveryStatus}`,
      });
    } catch (err) {
      console.error("internal.updatePrasadamStatus error:", err);
      return res.status(500).json({ success: false, message: err.message || "Failed to update prasadam status" });
    }
  },

  // GET /api/internal/drm/abandoned?since=&page=&limit=
  //
  // People who started a donation here and never finished it. The temple calls
  // them: most abandoned payments are a failed UPI app or a distracted donor,
  // not a change of heart, and a call recovers a good share of them.
  //
  // "created" is this site's word for payment initiated but never completed -
  // the same state runPendingReminders() in pendingReminder.controller.js sends
  // its WhatsApp nudge about. This is the follow-up for the ones the nudge did
  // not bring back.
  //
  // WHY minMinutes EXISTS: a donation sits in "created" for the whole time the
  // donor is on the payment page. Handing DRM a record that is ninety seconds
  // old would mean calling someone who is still typing their UPI PIN. Default
  // is an hour, well past the 6-minute reminder.
  //
  // This does NOT decide whether the person later gave successfully - DRM holds
  // every completed donation from both sites and is the only place that can
  // answer that across sites, so the filtering happens there.
  getAbandonedDonations: async (req, res) => {
    try {
      const page = Math.max(1, parseInt(req.query.page, 10) || 1);
      const limit = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 200));
      const minMinutes = Math.max(15, parseInt(req.query.minMinutes, 10) || 60);

      const filter = {
        status: { $in: ["created", "halted"] },
        createdAt: { $lte: new Date(Date.now() - minMinutes * 60 * 1000) },
        mobile: { $exists: true, $ne: "" },
      };
      if (req.query.since) {
        const since = new Date(req.query.since);
        if (!Number.isNaN(since.getTime())) filter.createdAt.$gte = since;
      }

      const [rows, total] = await Promise.all([
        donationModle
          .find(filter)
          .select("name mobile email amount occasion sourcePage status createdAt")
          .sort({ createdAt: -1 })
          .skip((page - 1) * limit)
          .limit(limit)
          .lean(),
        donationModle.countDocuments(filter),
      ]);

      res.status(200).json({
        success: true,
        page,
        limit,
        total,
        hasMore: page * limit < total,
        donations: rows.map((d) => ({
          externalId: String(d._id),
          name: d.name || null,
          mobile: d.mobile || null,
          email: d.email || null,
          amount: d.amount ?? null,
          purpose: d.occasion || null,
          sourcePage: d.sourcePage || null,
          status: d.status,
          attemptedAt: d.createdAt,
          sourceSite: "annadan",
        })),
      });
    } catch (err) {
      console.error("internal.getAbandonedDonations error:", err);
      res.status(500).json({ success: false, message: err.message || "Failed to list abandoned donations" });
    }
  },

  // GET /api/internal/donations/:id/receipt.pdf
  getReceiptPdf: async (req, res) => {
    try {
      const donation = await donationModle.findById(req.params.id);
      if (!donation) return res.status(404).json({ success: false, message: "Donation not found" });

      // Hard requirement: DCC must have issued the receipt already. Without a
      // receipt number, generating here would allocate a local one and block
      // the webhook's recovery path for this donation permanently.
      if (!donation.receiptNumber) {
        return res.status(409).json({
          success: false,
          message:
            "No receipt has been issued for this donation yet (DCC sync hasn't completed). " +
            "Generating one here would take a number out of the sequence and stop the payment " +
            "webhook from retrying, so it's refused.",
        });
      }

      const filePath = await regenerateWithoutSideEffects(donation);

      const fs = require("fs");
      if (!filePath || !fs.existsSync(filePath)) {
        return res.status(500).json({ success: false, message: "Receipt PDF could not be produced." });
      }

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="receipt-${String(donation.receiptNumber).replace(/[^a-zA-Z0-9-]/g, "-")}.pdf"`
      );
      fs.createReadStream(filePath).pipe(res);
    } catch (err) {
      console.error("internal.getReceiptPdf error:", err);
      res.status(500).json({ success: false, message: "Could not generate receipt." });
    }
  },

  // POST /api/internal/donations/:id/resend-receipt
  //
  // Regenerates the PDF and sends it over WhatsApp. NOTE: unlike
  // hkmsite2.0-server, this site has no existing "send the receipt" call site
  // anywhere in its codebase - generateReceipt and sendReceiptWhatsapp are both
  // defined but never invoked together - so this pairs them directly. Worth
  // confirming against however receipts actually reach donors here today.
  resendReceipt: async (req, res) => {
    try {
      const donation = await donationModle.findById(req.params.id);
      if (!donation) return res.status(404).json({ success: false, message: "Donation not found" });
      if (!donation.mobile) {
        return res.status(400).json({ success: false, message: "This donation has no mobile number to send to." });
      }
      if (!donation.receiptNumber) {
        return res.status(409).json({
          success: false,
          message:
            "No receipt has been issued for this donation yet (DCC sync hasn't completed), so there is " +
            "nothing to resend. Generating one here would block the payment webhook from retrying.",
        });
      }

      // Idempotency lock, taken BEFORE any sending.
      //
      // A single atomic findOneAndUpdate: the update only matches if no resend
      // happened inside the cooldown, so two concurrent requests (a
      // double-click, or a client retry on a slow response) can never both
      // win - the second matches nothing and is refused. Checking-then-writing
      // as two steps would leave exactly that race open.
      const now = new Date();
      const cutoff = new Date(now.getTime() - RESEND_COOLDOWN_MS);
      const locked = await donationModle.findOneAndUpdate(
        {
          _id: donation._id,
          $or: [{ receiptResendAt: { $exists: false } }, { receiptResendAt: null }, { receiptResendAt: { $lte: cutoff } }],
        },
        { $set: { receiptResendAt: now } },
        { new: true }
      );

      if (!locked) {
        const waitSec = Math.max(
          1,
          Math.ceil((RESEND_COOLDOWN_MS - (now - new Date(donation.receiptResendAt))) / 1000)
        );
        return res.status(429).json({
          success: false,
          alreadySent: true,
          message: `This receipt was just re-sent. Try again in ${waitSec}s if the donor still hasn't received it.`,
        });
      }

      try {
        const filePath = await regenerateWithoutSideEffects(locked);
        if (!filePath) {
          throw new Error("Receipt PDF could not be produced.");
        }

        const { sendReceiptWhatsapp } = require("../services/whatsapp.service");
        const phone = `91${normalizeMobile(locked.mobile)}`;

        await sendReceiptWhatsapp(
          phone,
          filePath,
          locked.name,
          locked.amount,
          locked.isRecurring ? "subscription" : "normal"
        );

        return res.json({ success: true, sentTo: phone, receiptNumber: locked.receiptNumber });
      } catch (sendErr) {
        // The send failed, so release the lock - otherwise a transient WhatsApp
        // error would lock staff out of retrying for the whole cooldown.
        await donationModle.findByIdAndUpdate(locked._id, {
          $set: { receiptResendAt: donation.receiptResendAt || null },
        });
        throw sendErr;
      }
    } catch (err) {
      console.error("internal.resendReceipt error:", err);
      res
        .status(502)
        .json({ success: false, message: err && err.message ? err.message : "Could not resend the receipt." });
    }
  },

  // PUT /api/internal/drm/donors/by-mobile/:mobile/profile
  //
  // A correction made in DRM, pushed here.
  //
  // WHY THIS SITE IS THE AWKWARD ONE
  // There is no donor collection here. A donor is a mobile number that several
  // donations happen to share, and the name and address live on each donation
  // row. So there is no profile to update - only donations.
  //
  // WHAT IT WRITES, AND WHY ONLY THAT
  // The MOST RECENT donation only. That is the row a receipt reprint reads and
  // the row a pending prasadam delivery is addressed from, so correcting it is
  // what actually reaches the donor. Older donations are left exactly as the
  // receipts already issued against them describe - rewriting those would make
  // an issued receipt disagree with the record behind it, which for an 80G
  // receipt is a real problem and not a tidiness question.
  //
  // The name is the exception: it is corrected across all of this donor's
  // donations, because a misspelt name is a misspelling on every row and
  // nobody reconciles receipts by donor name.
  updateDonorProfile: async (req, res) => {
    try {
      const mobile = normalizeMobile(req.params.mobile);
      if (!mobile) return res.status(400).json({ success: false, message: "Mobile number required" });

      const donations = await findDonationsForMobile(mobile);
      if (!donations.length) {
        return res.json({ success: true, applied: false, message: "No donation from that mobile on this site." });
      }

      const latest = donations[0];
      const { name, email, panNumber, address } = req.body || {};
      const changed = [];
      const set = {};

      if (typeof email === "string" && email.trim()) set.email = email.trim();
      if (typeof panNumber === "string" && panNumber.trim()) {
        set.panNumber = panNumber.trim().toUpperCase();
      }

      if (address && typeof address === "object") {
        if (typeof address.address === "string" && address.address.trim()) set.address = address.address.trim();
        if (typeof address.city === "string" && address.city.trim()) set.city = address.city.trim();
        if (typeof address.state === "string" && address.state.trim()) set.state = address.state.trim();
        if (typeof address.pincode === "string" && address.pincode.trim()) set.pincode = address.pincode.trim();
        if (Object.keys(set).some((k) => ["address", "city", "state", "pincode"].includes(k))) {
          changed.push("address");
        }
      }
      if (set.email) changed.push("email");
      if (set.panNumber) changed.push("panNumber");

      if (Object.keys(set).length) {
        await donationModle.updateOne({ _id: latest._id }, { $set: set });
      }

      // The name, across every donation from this number.
      let renamed = 0;
      if (typeof name === "string" && name.trim()) {
        const clean = name.trim().slice(0, 120);
        const r = await donationModle.updateMany(
          { mobile, name: { $ne: clean } },
          { $set: { name: clean } }
        );
        renamed = r.modifiedCount || 0;
        if (renamed) changed.push("name");
      }

      if (!changed.length) {
        return res.json({ success: true, applied: false, message: "Nothing here differed." });
      }

      res.json({
        success: true,
        applied: true,
        changed,
        donationId: String(latest._id),
        message:
          `Updated ${changed.join(", ")} on the most recent donation` +
          (renamed ? `, and the name on ${renamed} donation${renamed === 1 ? "" : "s"}.` : "."),
      });
    } catch (err) {
      console.error("internal.updateDonorProfile error:", err);
      res.status(500).json({ success: false, message: "Server error" });
    }
  },
};

module.exports = { internalController, normalizeMobile };
