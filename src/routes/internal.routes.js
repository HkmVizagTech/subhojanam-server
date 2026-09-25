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
internalRouter.get("/donations/:id/receipt.pdf", internalController.getReceiptPdf);
internalRouter.post("/donations/:id/resend-receipt", internalController.resendReceipt);

module.exports = { internalRouter };
