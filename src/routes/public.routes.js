const express = require("express");
const { festivalCampaignController } = require("../controllers/festivalCampaign.controller");
const { donationModle } = require("../models/donation.model");

const publicRouter = express.Router();

// Public — no auth. Used by the donation page to fetch the active
// festival banner (if any) matching the visitor's utm_campaign.
publicRouter.get("/festival-campaign", festivalCampaignController.getCampaignByUtm);

// Temporary diagnostic — will be removed after investigation
publicRouter.get("/diag-payments", async (req, res) => {
  try {
    const ids = (req.query.ids || "").split(",").filter(id => id.startsWith("pay_"));
    if (!ids.length) return res.json({ error: "No valid payment IDs" });
    const results = await Promise.all(ids.map(async (paymentId) => {
      const d = await donationModle.findOne({ razorpayPaymentId: paymentId })
        .select("name mobile amount status razorpayPaymentId subscriptionId isRecurring receiptGeneratedAt externalApiSentAt donorNumber webhookProcessed createdAt");
      if (!d) return { paymentId, inDB: false };
      return {
        paymentId,
        inDB: true,
        name: d.name,
        mobile: d.mobile,
        amount: d.amount,
        status: d.status,
        isRecurring: d.isRecurring,
        webhookProcessed: d.webhookProcessed,
        dccSent: !!d.externalApiSentAt,
        donorNumber: d.donorNumber,
        receiptGenerated: !!d.receiptGeneratedAt,
        createdAt: d.createdAt,
      };
    }));
    res.json({ results });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = { publicRouter };
