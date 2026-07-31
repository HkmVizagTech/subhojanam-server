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

publicRouter.get("/diag-fix-orphan", async (req, res) => {
  try {
    const { orphanRecordId, correctName, correctMobile, correctAmount, correctSubscriptionId } = req.query;
    if (!orphanRecordId) return res.json({ error: "orphanRecordId required" });
    const d = await donationModelForBackfill.findById(orphanRecordId);
    if (!d) return res.json({ error: "Record not found" });

    const before = { name: d.name, mobile: d.mobile, amount: d.amount, subscriptionId: d.subscriptionId };

    if (correctName) d.name = correctName;
    if (correctMobile) d.mobile = correctMobile;
    if (correctAmount) d.amount = Number(correctAmount);
    if (correctSubscriptionId) d.subscriptionId = correctSubscriptionId;
    await d.save();

    res.json({ success: true, before, after: { name: d.name, mobile: d.mobile, amount: d.amount, subscriptionId: d.subscriptionId } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Find duplicate record pairs: same mobile + same amount + within 10 minutes,
// where one has a real pay_ ID and the other doesn't (or has a non-pay_ ID).
// READ ONLY — shows what would be merged, changes nothing.
publicRouter.get("/diag-find-duplicates", async (req, res) => {
  try {
    const all = await donationModelForBackfill
      .find({ status: { $in: ["paid", "active", "created"] } })
      .select("name mobile amount razorpayPaymentId subscriptionId receiptNumber receiptGeneratedAt donorNumber createdAt status isRecurring")
      .sort({ createdAt: 1 })
      .lean();

    // Group by mobile+amount
    const groups = {};
    for (const d of all) {
      const key = `${d.mobile}__${d.amount}`;
      if (!groups[key]) groups[key] = [];
      groups[key].push(d);
    }

    const duplicatePairs = [];

    for (const key in groups) {
      const recs = groups[key];
      if (recs.length < 2) continue;

      for (let i = 0; i < recs.length; i++) {
        for (let j = i + 1; j < recs.length; j++) {
          const a = recs[i], b = recs[j];
          const minsApart = Math.abs(new Date(a.createdAt) - new Date(b.createdAt)) / 60000;
          if (minsApart > 10) continue;

          const aHasPay = (a.razorpayPaymentId || "").startsWith("pay_");
          const bHasPay = (b.razorpayPaymentId || "").startsWith("pay_");

          // Interesting case: one has a real pay_ ID, other doesn't
          if (aHasPay !== bHasPay) {
            const withPay = aHasPay ? a : b;
            const withoutPay = aHasPay ? b : a;
            duplicatePairs.push({
              mobile: a.mobile,
              name: (a.name || "").trim(),
              amount: a.amount,
              minutesApart: Math.round(minsApart * 10) / 10,
              keepRecord: {
                id: withoutPay._id,
                createdAt: withoutPay.createdAt,
                paymentId: withoutPay.razorpayPaymentId || "NONE",
                receiptNumber: withoutPay.receiptNumber || "NONE",
                hasReceipt: !!withoutPay.receiptGeneratedAt,
                subscriptionId: withoutPay.subscriptionId || "NONE",
                status: withoutPay.status,
              },
              duplicateRecord: {
                id: withPay._id,
                createdAt: withPay.createdAt,
                paymentId: withPay.razorpayPaymentId,
                receiptNumber: withPay.receiptNumber || "NONE",
                hasReceipt: !!withPay.receiptGeneratedAt,
                subscriptionId: withPay.subscriptionId || "NONE",
                status: withPay.status,
              },
              bothHaveReceipts: !!withoutPay.receiptGeneratedAt && !!withPay.receiptGeneratedAt,
            });
          }
        }
      }
    }

    res.json({
      totalPairs: duplicatePairs.length,
      pairsWithTwoReceipts: duplicatePairs.filter(p => p.bothHaveReceipts).length,
      duplicatePairs,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Merge a duplicate pair. Keeps the record holding the REAL payment ID and
// receipt; deletes the spurious placeholder. Refuses any unsafe combination.
// Pass ?dryRun=true to preview.
publicRouter.get("/diag-merge-duplicate", async (req, res) => {
  try {
    const { placeholderId, realId, dryRun } = req.query;
    if (!placeholderId || !realId) {
      return res.json({ error: "placeholderId (the record with no payment ID) and realId (the record with pay_ ID) required" });
    }

    const placeholder = await donationModelForBackfill.findById(placeholderId);
    const real = await donationModelForBackfill.findById(realId);
    if (!placeholder) return res.json({ error: "placeholder record not found" });
    if (!real) return res.json({ error: "real record not found" });

    // Safety guards
    if (placeholder.razorpayPaymentId) {
      return res.json({ error: "placeholder record HAS a payment ID — wrong record passed, aborting" });
    }
    if (!(real.razorpayPaymentId || "").startsWith("pay_")) {
      return res.json({ error: "real record does not have a valid pay_ ID — aborting" });
    }
    if (!real.receiptGeneratedAt) {
      return res.json({ error: "real record has no receipt — refusing to delete the placeholder which may hold the only receipt" });
    }
    if (real.mobile !== placeholder.mobile) {
      return res.json({ error: "mobile numbers differ between the two records — aborting" });
    }

    const plan = {
      keeping: {
        id: real._id, name: real.name, amount: real.amount,
        paymentId: real.razorpayPaymentId,
        receiptNumber: real.receiptNumber || "NONE",
        willInheritSubscriptionId: !real.subscriptionId && placeholder.subscriptionId ? placeholder.subscriptionId : null,
      },
      deleting: {
        id: placeholder._id, name: placeholder.name, amount: placeholder.amount,
        receiptNumber: placeholder.receiptNumber || "NONE",
        status: placeholder.status,
        action: placeholder.receiptNumber ? "CANCEL THIS RECEIPT AT DCC" : "no receipt — nothing to cancel",
      },
    };

    if (dryRun === "true") return res.json({ dryRun: true, plan });

    // Real record inherits the subscription link if it lacks one
    if (!real.subscriptionId && placeholder.subscriptionId) {
      real.subscriptionId = placeholder.subscriptionId;
      real.isRecurring = true;
      await real.save();
    }

    await donationModelForBackfill.findByIdAndDelete(placeholderId);

    res.json({ success: true, merged: plan });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = { publicRouter };
