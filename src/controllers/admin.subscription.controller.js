const { donationModle } = require("../models/donation.model");
const { razorpay } = require("../config/razorpay");

const adminSubscriptionController = {

  getAllSubscriptions: async (req, res) => {
  try {
    const localSubs = await donationModle.find({
      isRecurring: true
    }).sort({ createdAt: -1 });

    const enrichedSubs = await Promise.all(
      localSubs.map(async (sub) => {
        try {
          if (!sub.subscriptionId) {
            console.log(`Missing subscriptionId for donation: ${sub._id}`);
            return {
              ...sub.toObject(),
              razorStatus: "sync_error",
              errorReason: "Missing subscription ID"
            };
          }

          const razorData = await razorpay.subscriptions.fetch(sub.subscriptionId);

          return {
            ...sub.toObject(),
            razorStatus: razorData.status,
            paidCount: razorData.paid_count,
            remainingCount: razorData.remaining_count,
            currentStart: razorData.current_start,
            currentEnd: razorData.current_end,
            nextChargeAt: razorData.charge_at
          };

        } catch (err) {
          console.error(`Razorpay fetch error for subscription ${sub.subscriptionId}:`);
          console.error('Error details:', JSON.stringify(err, null, 2));
          console.error('Error description:', err.error?.description || err.message || 'Unknown error');
          
          return {
            ...sub.toObject(),
            razorStatus: "sync_error",
            errorReason: err.error?.description || err.message || "Failed to fetch from Razorpay"
          };
        }
      })
    );

    res.status(200).json({
      success: true,
      count: enrichedSubs.length,
      data: enrichedSubs
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
    const subscriptions = await donationModle.find({
      isRecurring: true
    });

    let active = 0;
    let cancelled = 0;
    let halted = 0;

    for (const sub of subscriptions) {
      try {
        const razor = await razorpay.subscriptions.fetch(sub.subscriptionId);

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
        total: subscriptions.length
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