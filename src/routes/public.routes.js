const express = require("express");
const { festivalCampaignController } = require("../controllers/festivalCampaign.controller");
const { donationModle } = require("../models/donation.model");

const publicRouter = express.Router();

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
        paymentId, inDB: true, name: d.name, mobile: d.mobile,
        amount: d.amount, status: d.status, isRecurring: d.isRecurring,
        webhookProcessed: d.webhookProcessed, dccSent: !!d.externalApiSentAt,
        donorNumber: d.donorNumber, receiptGenerated: !!d.receiptGeneratedAt,
        createdAt: d.createdAt,
      };
    }));
    res.json({ results });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Webhook signature test — logs what our server receives vs what it expects
publicRouter.post("/test-webhook-sig", express.raw({ type: "application/json" }), (req, res) => {
  const crypto = require("crypto");
  const signature = req.headers["x-razorpay-signature"];
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  const body = req.body.toString();

  const expected = crypto.createHmac("sha256", secret || "").update(body).digest("hex");

  res.json({
    signatureReceived: signature || "MISSING",
    signatureExpected: expected,
    secretConfigured: !!secret,
    secretLength: secret ? secret.length : 0,
    match: signature === expected,
    bodyLength: body.length,
  });
});

module.exports = { publicRouter };
