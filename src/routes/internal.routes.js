const express = require("express");
const { internalController } = require("../controllers/internal.controller");

const internalRouter = express.Router();

// Shared-secret auth for the DRM integration.
//
// Deliberately NOT process.env.INTERNAL_SECRET: this site already uses that
// one for its own /api/internal/send-pending-reminders endpoint in index.js.
// Reusing it would mean the DRM integration and the reminders job share a
// credential - neither could be rotated without breaking the other, and a leak
// of one would expose both. DRM_SYNC_SECRET is this integration's own.
//
// The same variable is used for both directions (DRM calling in here, and
// drmNotify pushing out to DRM), because it is one trust relationship between
// two services - two names for one value would just be something else to keep
// in sync.
//
// Server-to-server only, never called from a browser.
internalRouter.use((req, res, next) => {
  const expected = process.env.DRM_SYNC_SECRET;
  if (!expected) {
    return res.status(503).json({
      success: false,
      message: "DRM integration is not configured on this server (DRM_SYNC_SECRET unset).",
    });
  }
  if (req.headers["x-internal-secret"] !== expected) {
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }
  next();
});

// Bulk sync reads the transaction feed - this site stores transactions, not
// donors, so it serves them raw and DRM does the grouping. Nothing here does
// cross-document work.
internalRouter.get("/transactions", internalController.listTransactions);

// Single-donor lookup, for DRM's per-donor Sync button and the webhook path.
internalRouter.get("/donors/by-mobile/:mobile", internalController.getDonorByMobile);
// A profile correction made in DRM. This site has no donor record, so the
// address goes onto the most recent donation - the row a receipt reprint and a
// pending delivery actually read - while the name is corrected across all of
// them. Older donations keep the address their receipts were issued with.
internalRouter.put("/donors/by-mobile/:mobile/profile", internalController.updateDonorProfile);
// Offline donation entered in DRM. Delegates to this site's own offline
// donation path, so DCC issues the receipt exactly as it does for the admin
// form here. Declared before "/donations/:id/..." so it is never read as an id.
internalRouter.post("/donations/offline", internalController.createOfflineDonation);

// Prasadam dispatch status set in DRM, pushed here so this site's Prasadam tab
// doesn't keep showing delivered boxes as pending. Writes only the prasadam
// fields of one donation, and is idempotent - re-sending the same status has no
// further effect. Does NOT message the donor unless the caller asks it to.
internalRouter.put("/donations/:id/prasadam-status", internalController.updatePrasadamStatus);

// Donations started here and never completed, for DRM to turn into leads the
// temple can ring. Read-only; nothing on this site is changed by it.
internalRouter.get("/abandoned", internalController.getAbandonedDonations);

internalRouter.get("/donations/:id/receipt.pdf", internalController.getReceiptPdf);
internalRouter.post("/donations/:id/resend-receipt", internalController.resendReceipt);

module.exports = { internalRouter };
