const crypto = require("crypto");
const { donationModle } = require("../models/donation.model");

const webHookControler = {
  webhook: async (req, res) => {
    try {
      
      const signature = req.headers["x-razorpay-signature"];
      const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
      console.log("ENV RAZORPAY_WEBHOOK_SECRET:", process.env.RAZORPAY_WEBHOOK_SECRET);

      if (!webhookSecret) {
        return res.status(500).send("Webhook secret not configured");
      }

      if (!signature) {
        return res.status(400).send("Signature missing");
      }

      const body = req.body.toString();

      const expectedSignature = crypto
        .createHmac("sha256", webhookSecret)
        .update(body)
        .digest("hex");

      if (expectedSignature !== signature) {
        console.log("Signature mismatch");
        return res.status(400).send("Invalid signature");
      }

      console.log("Received signature:", signature);
      console.log("Generated signature:", expectedSignature);

      const event = JSON.parse(body);
      console.log("Webhook Event:", event.event);

      switch (event.event) {
        case "payment.captured": {
          const payment = event.payload.payment.entity;

          await donationModle.findOneAndUpdate(
            {
              razorpayOrderId: payment.order_id,
              status: { $ne: "paid" },
            },
            {
              status: "paid",
              razorpayPaymentId: payment.id,
            },
          );

          break;
        }

        case "subscription.activated": {
          const subscription = event.payload.subscription.entity;

          await donationModle.findOneAndUpdate(
            { subscriptionId: subscription.id },
            { status: "active" },
          );

          break;
        }

        case "subscription.charged": {
          const payment = event.payload.payment.entity;

          await donationModle.findOneAndUpdate(
            { subscriptionId: payment.subscription_id },
            {
              status: "paid",
              razorpayPaymentId: payment.id,
            },
          );

          break;
        }

        case "subscription.cancelled": {
          const subscription = event.payload.subscription.entity;

          await donationModle.findOneAndUpdate(
            { subscriptionId: subscription.id },
            { status: "cancelled" },
          );

          break;
        }

        case "subscription.completed": {
          const subscription = event.payload.subscription.entity;

          await donationModle.findOneAndUpdate(
            { subscriptionId: subscription.id },
            { status: "completed" },
          );

          break;
        }

        default:
          console.log("Unhandled event:", event.event);
      }

      return res.status(200).send("Webhook processed");
    } catch (error) {
      console.error("Webhook Error:", error);
      return res.status(500).send("Webhook error");
    }
  },
};

module.exports = { webHookControler };
