const { donationModle } = require("../models/donation.model");
const { razorpay } = require("../config/razorpay");

const adminSubscriptionController = {

  getAllSubscriptions: async (req, res) => {
  try {
    // Every recurring donation record — includes the original signup AND
    // each monthly charge. We must collapse these into ONE row per subscription.
    const allRecurring = await donationModle.find({
      isRecurring: true
    }).sort({ createdAt: 1 });

    // Group by subscriptionId
    const bySubscription = {};
    const orphans = []; // recurring records with no subscriptionId at all

    for (const rec of allRecurring) {
      if (!rec.subscriptionId) {
        orphans.push(rec);
        continue;
      }
      if (!bySubscription[rec.subscriptionId]) {
        bySubscription[rec.subscriptionId] = [];
      }
      bySubscription[rec.subscriptionId].push(rec);
    }

    const uniqueSubs = [];

    for (const subId in bySubscription) {
      const charges = bySubscription[subId];
      // Earliest record = the original signup, holds canonical donor details
      const original = charges[0];
      const latest = charges[charges.length - 1];

      // Only count records that represent an actual payment
      const realCharges = charges.filter(c => c.razorpayPaymentId);
      const totalPaid = realCharges.reduce((sum, c) => sum + (Number(c.amount) || 0), 0);
      const receiptsGenerated = realCharges.filter(c => c.receiptGeneratedAt).length;

      uniqueSubs.push({
        ...original.toObject(),
        _chargeCount: realCharges.length,
        _totalPaid: totalPaid,
        _receiptsGenerated: receiptsGenerated,
        _missingReceipts: realCharges.length - receiptsGenerated,
        _lastChargeDate: latest.createdAt,
      });
    }

    // Sort newest signup first
    uniqueSubs.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    const enrichedSubs = await Promise.all(
      uniqueSubs.map(async (sub) => {
        try {
          const razorData = await razorpay.subscriptions.fetch(sub.subscriptionId);
          return {
            ...sub,
            razorStatus: razorData.status,
            paidCount: razorData.paid_count,
            remainingCount: razorData.remaining_count,
            currentStart: razorData.current_start,
            currentEnd: razorData.current_end,
            nextChargeAt: razorData.charge_at
          };
        } catch (err) {
          console.error(`Razorpay fetch error for subscription ${sub.subscriptionId}:`, err.error?.description || err.message);
          return {
            ...sub,
            razorStatus: "sync_error",
            errorReason: err.error?.description || err.message || "Failed to fetch from Razorpay"
          };
        }
      })
    );

    // Surface orphaned recurring records so they aren't silently hidden
    const orphanRows = orphans.map(o => ({
      ...o.toObject(),
      razorStatus: "sync_error",
      errorReason: "Missing subscription ID",
      _chargeCount: o.razorpayPaymentId ? 1 : 0,
      _totalPaid: o.razorpayPaymentId ? (Number(o.amount) || 0) : 0,
    }));

    const data = [...enrichedSubs, ...orphanRows];

    res.status(200).json({
      success: true,
      count: data.length,
      data
    });

  } catch (error) {
    console.error("Get Subscriptions Error:", error);
    res.status(500).json({ success: false });
  }
},


  getSubscriptionsForReview: async (req, res) => {
    try {
      const reviewList = await donationModle.find({
        isRecurring: true,
        status: { $in: ["pending", "halted"] },
        reviewAfter: { $lte: new Date() }
      });

      res.status(200).json({
        success: true,
        count: reviewList.length,
        data: reviewList
      });

    } catch (error) {
      console.error("Review Subscriptions Error:", error);
      res.status(500).json({ success: false });
    }
  },


  getSubscriptionStats: async (req, res) => {
  try {
    // Count UNIQUE subscriptions, not individual monthly charge records
    const uniqueSubIds = await donationModle.distinct("subscriptionId", {
      isRecurring: true,
      subscriptionId: { $exists: true, $nin: [null, ""] },
    });

    let active = 0;
    let cancelled = 0;
    let halted = 0;

    for (const subId of uniqueSubIds) {
      try {
        const razor = await razorpay.subscriptions.fetch(subId);

        if (razor.status === "active") active++;
        else if (razor.status === "cancelled") cancelled++;
        else if (razor.status === "halted") halted++;

      } catch (err) {}
    }

    res.status(200).json({
      success: true,
      stats: {
        active,
        cancelled,
        halted,
        total: uniqueSubIds.length
      }
    });

  } catch (error) {
    console.error("Subscription Stats Error:", error);
    res.status(500).json({ success: false });
  }
},


  cancelSubscription: async (req, res) => {
  try {
    const { id } = req.params;

    const donation = await donationModle.findById(id);

    if (!donation) {
      return res.status(404).json({
        success: false,
        message: "Subscription not found"
      });
    }

    const razorResponse = await razorpay.subscriptions.cancel(
      donation.subscriptionId,
      { cancel_at_cycle_end: 0 }
    );

    donation.status = "cancelled";
    await donation.save();

    res.status(200).json({
      success: true,
      message: "Subscription cancelled",
      razorStatus: razorResponse.status
    });

  } catch (error) {
    console.error("Cancel Subscription Error:", error);
    res.status(500).json({ success: false });
  }
}

};

module.exports = { adminSubscriptionController };