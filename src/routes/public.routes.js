const express = require("express");
const { festivalCampaignController } = require("../controllers/festivalCampaign.controller");
const { donationModle } = require("../models/donation.model");

const publicRouter = express.Router();

publicRouter.get("/festival-campaign", festivalCampaignController.getCampaignByUtm);

publicRouter.get("/diag-payments", async (req, res) => {
  try {
    const ids = (req.query.ids || "").split(",").filter(id => id.startsWith("pay_"));
    const subId = req.query.subId;

    const results = await Promise.all(ids.map(async (paymentId) => {
      const d = await donationModle.findOne({ razorpayPaymentId: paymentId })
        .select("name mobile amount status razorpayPaymentId subscriptionId isRecurring receiptGeneratedAt externalApiSentAt donorNumber webhookProcessed createdAt receiptGenerationLastError");
      if (!d) return { paymentId, inDB: false };
      return {
        paymentId, inDB: true, name: d.name, mobile: d.mobile,
        amount: d.amount, status: d.status, isRecurring: d.isRecurring,
        webhookProcessed: d.webhookProcessed, dccSent: !!d.externalApiSentAt,
        donorNumber: d.donorNumber, receiptGenerated: !!d.receiptGeneratedAt,
        lastError: d.receiptGenerationLastError, createdAt: d.createdAt,
      };
    }));

    let subRecords = [];
    if (subId) {
      const docs = await donationModle.find({ subscriptionId: subId })
        .sort({ createdAt: 1 })
        .select("name mobile amount status subscriptionId isRecurring receiptGeneratedAt externalApiSentAt donorNumber webhookProcessed createdAt razorpayPaymentId receiptGenerationLastError");
      subRecords = docs.map(d => ({
        id: d._id, name: (d.name || "").trim(), mobile: d.mobile,
        amount: d.amount, status: d.status, isRecurring: d.isRecurring,
        webhookProcessed: d.webhookProcessed,
        dccSent: !!d.externalApiSentAt, donorNumber: d.donorNumber,
        receiptGenerated: !!d.receiptGeneratedAt,
        lastError: d.receiptGenerationLastError,
        paymentIdRaw: d.razorpayPaymentId === undefined ? "FIELD_UNDEFINED" : (d.razorpayPaymentId === null ? "FIELD_NULL" : (d.razorpayPaymentId === "" ? "FIELD_EMPTY_STRING" : d.razorpayPaymentId)),
        createdAt: d.createdAt,
      }));
    }

    res.json({ results, subRecords });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const { razorpay } = require("../config/razorpay");

publicRouter.get("/diag-invoices", async (req, res) => {
  try {
    const subId = req.query.subId;
    if (!subId) return res.json({ error: "subId required" });
    const invoiceResp = await razorpay.invoices.all({ subscription_id: subId, count: 100 });
    const invoices = (invoiceResp.items || []).map(inv => ({
      status: inv.status,
      payment_id: inv.payment_id,
      amount: inv.amount ? inv.amount / 100 : null,
      created_at: inv.created_at ? new Date(inv.created_at * 1000).toISOString() : null,
      paid_at: inv.paid_at ? new Date(inv.paid_at * 1000).toISOString() : null,
    }));
    res.json({ count: invoices.length, invoices });
  } catch (e) {
    res.status(500).json({ error: e.message, details: e.error || e });
  }
});

const { donationModle: donationModelForBackfill } = require("../models/donation.model");

publicRouter.get("/diag-backfill-paymentid", async (req, res) => {
  try {
    const { recordId, paymentId } = req.query;
    if (!recordId || !paymentId) return res.json({ error: "recordId and paymentId required" });
    const d = await donationModelForBackfill.findById(recordId);
    if (!d) return res.json({ error: "Record not found" });
    if (d.razorpayPaymentId) return res.json({ error: "Record already has a razorpayPaymentId, refusing to overwrite", current: d.razorpayPaymentId });
    d.razorpayPaymentId = paymentId;
    await d.save();
    res.json({ success: true, recordId, paymentId, name: d.name });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

publicRouter.get("/diag-find-by-payment", async (req, res) => {
  try {
    const { paymentId } = req.query;
    if (!paymentId) return res.json({ error: "paymentId required" });
    const d = await donationModelForBackfill.findOne({ razorpayPaymentId: paymentId });
    if (!d) return res.json({ found: false });
    res.json({
      found: true,
      id: d._id,
      name: d.name,
      mobile: d.mobile,
      amount: d.amount,
      subscriptionId: d.subscriptionId || "NONE",
      isRecurring: d.isRecurring,
      receiptGenerated: !!d.receiptGeneratedAt,
      createdAt: d.createdAt,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = { publicRouter };
