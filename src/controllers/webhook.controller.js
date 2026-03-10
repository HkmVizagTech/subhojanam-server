const crypto = require("crypto");
const { donationModle } = require("../models/donation.model");
const { generateReceipt } = require("../services/receipt.service");
const { sendReceiptWhatsapp } = require("../services/whatsapp.service");
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
        // case "payment.captured": {
        //   const payment = event.payload.payment.entity;

        //   await donationModle.findOneAndUpdate(
        //     {
        //       razorpayOrderId: payment.order_id,
        //       status: { $ne: "paid" },
        //     },
        //     {
        //       status: "paid",
        //       razorpayPaymentId: payment.id,
        //     },
        //   );

        //   break;
        // }

    case "payment.captured": {

  const payment = event.payload.payment.entity;
  console.log("=== PAYMENT CAPTURED WEBHOOK ===");
  console.log("Payment ID:", payment.id);
  console.log("Order ID from Razorpay:", payment.order_id);
  console.log("Payment Amount:", payment.amount / 100);
  console.log("Payment Status:", payment.status);

  // First check if donation exists at all
  const existingDonation = await donationModle.findOne({ razorpayOrderId: payment.order_id });
  console.log("Searching DB for razorpayOrderId:", payment.order_id);
  console.log("Existing donation found:", existingDonation ? "YES" : "NO");
  
  if (existingDonation) {
    console.log("Existing donation ID:", existingDonation._id);
    console.log("Existing donation status:", existingDonation.status);
    console.log("Existing donation amount:", existingDonation.amount);
    console.log("Existing donation certificate:", existingDonation.certificate);
  } else {
    // If not found, let's check what donations exist recently
    const recentDonations = await donationModle.find().sort({ createdAt: -1 }).limit(5).select('razorpayOrderId amount status createdAt');
    console.log("Recent donations in DB:", JSON.stringify(recentDonations, null, 2));
  }

  const donation = await donationModle.findOneAndUpdate(
    {
      razorpayOrderId: payment.order_id,
      status: { $ne: "paid" }
    },
    {
      status: "paid",
      razorpayPaymentId: payment.id
    },
    { new: true }
  );

  console.log("Donation found:", donation ? donation._id : "NULL");
  console.log("Donation certificate:", donation?.certificate);
  console.log("Donation amount:", donation?.amount);

  if (!donation) {
    console.log("No donation found or already processed. Checking if receipt already sent...");
    
    // Check if this donation exists and already has a receipt
    if (existingDonation && existingDonation.status === "paid") {
      console.log("Donation already processed (status: paid). Checking receipt...");
      
      if (existingDonation.certificate === true && existingDonation.amount >= 1 && !existingDonation.receiptNumber) {
        console.log("Receipt not yet generated for this paid donation. Generating now...");
        
        try {
          const filePath = await generateReceipt(existingDonation);
          console.log("Receipt generated successfully at:", filePath);

          const phone = existingDonation.mobile.startsWith("91")
            ? existingDonation.mobile
            : `91${existingDonation.mobile}`;

          console.log("Sending WhatsApp to:", phone);
          await sendReceiptWhatsapp(phone, filePath, existingDonation.name, existingDonation.amount);
          console.log("WhatsApp sent successfully!");
        } catch (error) {
          console.error("Error in receipt generation/WhatsApp:", error);
        }
      } else {
        console.log("Receipt already generated or not eligible. receiptNumber:", existingDonation.receiptNumber);
      }
    }
    break;
  }

  if (donation.certificate === true && donation.amount >= 1) {
    console.log("Conditions met! Starting receipt generation...");
    try {
      console.log("Starting receipt generation for donation:", donation._id);
      const filePath = await generateReceipt(donation);
      console.log("Receipt generated successfully at:", filePath);

      const phone = donation.mobile.startsWith("91")
        ? donation.mobile
        : `91${donation.mobile}`;

      console.log("Sending WhatsApp to:", phone);
      await sendReceiptWhatsapp(phone, filePath, donation.name, donation.amount);
      console.log("WhatsApp sent successfully!");
    } catch (error) {
      console.error("Error in receipt generation/WhatsApp:", error);
    }
  } else {
    console.log("Conditions NOT met for receipt generation");
    console.log("Certificate:", donation.certificate, "Amount:", donation.amount);
  }

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
