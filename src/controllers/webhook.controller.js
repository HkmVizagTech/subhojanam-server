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

        case "payment.captured": {

          const payment = event.payload.payment.entity;

          const existingDonation = await donationModle.findOne({ razorpayOrderId: payment.order_id });
          console.log("Searching DB for razorpayOrderId:", payment.order_id);
          console.log("Existing donation found:", existingDonation ? "YES" : "NO");
          
          if (existingDonation) {
            console.log("Existing donation ID:", existingDonation._id);
            console.log("Existing donation status:", existingDonation.status);
            console.log("Existing donation amount:", existingDonation.amount);
            console.log("Existing donation certificate:", existingDonation.certificate);
          } else {
            const recentDonations = await donationModle.find().sort({ createdAt: -1 }).limit(5).select('razorpayOrderId amount status createdAt');
            console.log("Recent donations in DB:", JSON.stringify(recentDonations, null, 2));
          }

          console.log("Attempting to update donation status to 'paid'...");
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

          console.log("Update result - Donation found:", donation ? "YES" : "NO");
          
          if (donation) {
            console.log("Successfully updated donation to paid status");
            console.log("Donation ID:", donation._id);
            console.log("Donation certificate:", donation.certificate);
            console.log("Donation amount:", donation.amount);
          } else {
            console.log("Failed to update - checking current status again...");
            const recheckDonation = await donationModle.findOne({ razorpayOrderId: payment.order_id });
            console.log("Recheck - Donation status now:", recheckDonation ? recheckDonation.status : "NOT FOUND");
          }

          if (!donation) {
            console.log("No donation found or already processed. Checking if receipt already sent...");
            
            if (existingDonation) {
              console.log("Using existing donation data for receipt generation");
              
              if (existingDonation.amount >= 1) {
                console.log("Donation qualifies for receipt (amount >= 1). Checking if already generated...");
                
                const latestDonation = await donationModle.findById(existingDonation._id);
                
                if (latestDonation && !latestDonation.receiptNumber) {
                  console.log("Receipt not yet generated. Generating now...");
                  
                  try {
                    const filePath = await generateReceipt(latestDonation);
                    console.log("Receipt generated successfully at:", filePath);

                    const phone = latestDonation.mobile.startsWith("91")
                      ? latestDonation.mobile
                      : `91${latestDonation.mobile}`;

                    console.log("Sending WhatsApp to:", phone);
                    let paymentType = "normal";
                    if (latestDonation.subscriptionId || latestDonation.isRecurring) {
                      paymentType = "subscription";
                    }
                    await sendReceiptWhatsapp(phone, filePath, latestDonation.name, latestDonation.amount, paymentType); 
                    console.log("WhatsApp sent successfully!");
                  } catch (error) {
                    console.error("Error in receipt generation/WhatsApp:", error);
                  }
                } else if (latestDonation && latestDonation.receiptNumber) {
                  console.log("Receipt already generated. Receipt number:", latestDonation.receiptNumber);
                } else {
                  console.log("Could not find donation for receipt generation");
                }
              } else {
                console.log("Donation does not qualify for receipt. Amount:", existingDonation.amount, "(must be >= 1000)");
              }
            }
            break;
          }

          if (donation.amount >= 1) {
            console.log("Conditions met! Starting receipt generation (amount >= 1000)...");
            try {
              console.log("Starting receipt generation for donation:", donation._id);
              const filePath = await generateReceipt(donation);
              console.log("Receipt generated successfully at:", filePath);

              const phone = donation.mobile.startsWith("91")
                ? donation.mobile
                : `91${donation.mobile}`;

              console.log("Sending WhatsApp to:", phone);
              let paymentType = "normal";
              if (donation.subscriptionId || donation.isRecurring) {
                paymentType = "subscription";
              }
              await sendReceiptWhatsapp(phone, filePath, donation.name, donation.amount, paymentType);
              console.log("WhatsApp sent successfully!");
            } catch (error) {
              console.error("Error in receipt generation/WhatsApp:", error);
            }
          } else {
            console.log("Conditions NOT met for receipt generation");
            console.log("Amount:", donation.amount, "(must be >= 1000)");
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

          const donation = await donationModle.findOneAndUpdate(
            { subscriptionId: payment.subscription_id, status: { $ne: "paid" } },
            {
              status: "paid",
              razorpayPaymentId: payment.id,
            },
            { new: true }
          );

          if (donation && donation.amount >= 1) {
            try {
              const filePath = await generateReceipt(donation);
              console.log("Receipt generated successfully at:", filePath);

              const phone = donation.mobile.startsWith("91")
                ? donation.mobile
                : `91${donation.mobile}`;

              console.log("Sending WhatsApp to:", phone);
              await sendReceiptWhatsapp(phone, filePath, donation.name, donation.amount, "subscription");
              console.log("WhatsApp sent successfully!");
            } catch (error) {
              console.error("Error in subscription receipt/WhatsApp:", error);
            }
          }

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