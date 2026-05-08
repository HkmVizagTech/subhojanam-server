const crypto = require("crypto");
const { donationModle } = require("../models/donation.model");
const receiptService = require("../services/receipt.service");
const whatsappService = require("../services/whatsapp.service");
const externalDonationService = require("../services/externalDonation.service");
const metaConversionService = require("../services/metaConversion.service");

const webHookControler = {
  webhook: async (req, res) => {
    try {
      const signature = req.headers["x-razorpay-signature"];
      const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
      console.log(
        "ENV RAZORPAY_WEBHOOK_SECRET:",
        process.env.RAZORPAY_WEBHOOK_SECRET,
      );

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

          // ✅ Respond to Razorpay immediately — RIGHT HERE, before anything else
          res.status(200).send("Webhook received");

          // Everything below runs AFTER response is sent
          try {
            let donation = await donationModle.findOne({
              razorpayOrderId: payment.order_id,
            });

            if (!donation) return;
            if (donation.receiptGeneratedAt) return;
            if (donation.webhookProcessed === true) {
              const stuckDuration =
                (new Date() - new Date(donation.webhookProcessedAt)) / 1000;
              if (stuckDuration < 120) return;
              await donationModle.findByIdAndUpdate(donation._id, {
                $set: { webhookProcessed: false },
                $unset: { webhookProcessedAt: "" },
              });
              donation = await donationModle.findById(donation._id);
            }

            donation = await donationModle.findByIdAndUpdate(
              donation._id,
              {
                $set: {
                  status: "paid",
                  razorpayPaymentId: payment.id,
                  webhookProcessed: true,
                  webhookProcessedAt: new Date(),
                },
              },
              { new: true },
            );

            if (!donation) return;

            // Meta (non-blocking)
            try {
              const metaResponse =
                await metaConversionService.sendPurchaseEvent(
                  donation,
                  payment,
                );
              await donationModle.findByIdAndUpdate(donation._id, {
                $set: {
                  metaPurchaseResponse: metaResponse,
                  metaPurchaseSentAt: new Date(),
                  metaPurchaseLastError: null,
                },
              });
            } catch (metaErr) {
              console.error("⚠️ Meta error:", metaErr.message);
            }

            if (donation.amount >= 1) {
              try {
                let apiResponse = null;
                try {
                  apiResponse = await externalDonationService.sendToExternalApi(
                    donation,
                    payment,
                  );
                  await donationModle.findByIdAndUpdate(donation._id, {
                    $set: {
                      externalApiResponse: apiResponse,
                      externalApiSentAt: new Date(),
                      donorNumber: apiResponse?.DonorNumber || "",
                    },
                  });
                } catch (apiErr) {
                  console.error("⚠️ BCC API error:", apiErr.message);
                }

                const filePath = await receiptService.generateReceipt(
                  donation,
                  apiResponse,
                );

                let phone = donation.mobile.replace(/\D/g, "");
                if (!phone.startsWith("91")) phone = `91${phone}`;

                await whatsappService.sendReceiptWhatsapp(
                  phone,
                  filePath,
                  donation.name,
                  donation.amount,
                  donation.subscriptionId || donation.isRecurring
                    ? "subscription"
                    : "normal",
                );

                console.log("🎉 Processing completed for:", donation._id);
              } catch (error) {
                console.error("❌ Receipt/WhatsApp error:", error.message);
                await donationModle.findByIdAndUpdate(donation._id, {
                  $inc: { receiptGenerationAttempts: 1 },
                  $set: {
                    receiptGenerationLastError: String(error.message || error),
                    webhookProcessed: false,
                  },
                });
              }
            }
          } catch (err) {
            console.error("❌ Webhook processing error:", err);
          }

          break; // ← break is still here, after the try/catch
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
            {
              subscriptionId: payment.subscription_id,
              status: { $ne: "paid" },
            },
            {
              status: "paid",
              razorpayPaymentId: payment.id,
            },
            { new: true },
          );

          if (donation) {
            // Meta conversion
            try {
              const metaResponse =
                await metaConversionService.sendPurchaseEvent(
                  donation,
                  payment,
                );
              await donationModle.findByIdAndUpdate(donation._id, {
                $set: {
                  metaPurchaseResponse: metaResponse,
                  metaPurchaseSentAt: new Date(),
                },
              });
            } catch (metaErr) {
              console.error("Meta error:", metaErr.message);
            }

            // Generate receipt
            if (donation.amount >= 1) {
              try {
                const filePath = await receiptService.generateReceipt(donation);
                const phone = donation.mobile.startsWith("91")
                  ? donation.mobile
                  : `91${donation.mobile}`;
                await whatsappService.sendReceiptWhatsapp(
                  phone,
                  filePath,
                  donation.name,
                  donation.amount,
                  "subscription",
                );
                console.log("✅ WhatsApp sent for subscription!");
              } catch (error) {
                console.error("Error in subscription receipt:", error);
              }
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
