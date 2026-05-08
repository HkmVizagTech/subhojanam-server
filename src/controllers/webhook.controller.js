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

          // ✅ CRITICAL: Check if already processed using atomic operation
          const donation = await donationModle.findOneAndUpdate(
            {
              razorpayOrderId: payment.order_id,
              $or: [
                { receiptGeneratedAt: { $exists: false } },
                { receiptGeneratedAt: null },
              ],
            },
            {
              $set: {
                status: "paid",
                razorpayPaymentId: payment.id,
                webhookProcessedAt: new Date(),
              },
              $setOnInsert: { webhookProcessed: true },
            },
            { new: true },
          );

          if (!donation) {
            console.log(
              "⚠️ Donation already processed or not found. Skipping duplicate webhook.",
            );
            return res.status(200).send("Already processed");
          }

          console.log("✅ Processing donation:", donation._id);

          // Meta conversion event (non-blocking)
          try {
            const metaResponse = await metaConversionService.sendPurchaseEvent(
              donation,
              payment,
            );
            const metaUpdate = metaResponse?.skipped
              ? {
                  metaPurchaseResponse: metaResponse,
                  metaPurchaseLastError:
                    metaResponse.reason || "Meta Purchase event skipped",
                }
              : {
                  metaPurchaseResponse: metaResponse,
                  metaPurchaseSentAt: new Date(),
                  metaPurchaseLastError: null,
                };
            await donationModle.findByIdAndUpdate(donation._id, {
              $set: metaUpdate,
            });
            console.log(
              "Meta Purchase event processed for donation:",
              donation._id,
            );
          } catch (metaErr) {
            console.error(
              "Meta Purchase event error (non-fatal):",
              metaErr.response?.data || metaErr.message || metaErr,
            );
            await donationModle.findByIdAndUpdate(donation._id, {
              $set: {
                metaPurchaseLastError: String(
                  metaErr.response?.data?.error?.message ||
                    metaErr.message ||
                    metaErr,
                ),
              },
            });
          }

          // ✅ Process receipt and WhatsApp only if amount qualifies
          if (donation.amount >= 1) {
            console.log(
              "✅ Starting receipt generation for amount:",
              donation.amount,
            );

            try {
              let apiResponse = null;

              // Call BCC API
              try {
                apiResponse = await externalDonationService.sendToExternalApi(
                  donation,
                  payment,
                );
                console.log(
                  "✅ External API returned:",
                  apiResponse?.ReceiptNumber,
                );

                await donationModle.findByIdAndUpdate(donation._id, {
                  $set: {
                    externalApiResponse: apiResponse,
                    externalApiSentAt: new Date(),
                  },
                });
              } catch (apiErr) {
                console.error(
                  "⚠️ External API error (continuing with fallback):",
                  apiErr.message,
                );
              }

              // Generate PDF receipt
              const filePath = await receiptService.generateReceipt(
                donation,
                apiResponse,
              );
              console.log("✅ Receipt PDF generated at:", filePath);

              // Send WhatsApp
              const phone = donation.mobile.startsWith("91")
                ? donation.mobile
                : `91${donation.mobile}`;

              console.log("📱 Sending WhatsApp to:", phone);
              const paymentType =
                donation.subscriptionId || donation.isRecurring
                  ? "subscription"
                  : "normal";

              await whatsappService.sendReceiptWhatsapp(
                phone,
                filePath,
                donation.name,
                donation.amount,
                paymentType,
              );
              console.log("✅ WhatsApp sent successfully!");
            } catch (error) {
              console.error("❌ Error in receipt generation/WhatsApp:", error);
              await donationModle.findByIdAndUpdate(donation._id, {
                $inc: { receiptGenerationAttempts: 1 },
                $set: {
                  receiptGenerationLastError: String(error.message || error),
                },
              });
            }
          } else {
            console.log(
              "⚠️ Amount too low for receipt generation:",
              donation.amount,
            );
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
