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
          console.log("💰 Payment captured:", payment.id);
          console.log("📦 Order ID:", payment.order_id);

          // FIRST: Find the donation without any webhookProcessed condition
          let donation = await donationModle.findOne({
            razorpayOrderId: payment.order_id,
          });

          if (!donation) {
            console.error(
              "❌ No donation found for order ID:",
              payment.order_id,
            );
            // Don't return error - Razorpay will retry
            return res.status(200).send("Donation not found - will retry");
          }

          console.log("📋 Found donation:", donation._id);
          console.log("   Status:", donation.status);
          console.log("   Webhook Processed:", donation.webhookProcessed);
          console.log("   Receipt Generated:", donation.receiptGeneratedAt);

          // Check if already fully processed
          if (donation.receiptGeneratedAt) {
            console.log("✅ Donation already has receipt. Skipping.");
            return res.status(200).send("Already processed");
          }

          // If webhookProcessed is true but no receipt, something went wrong
          // Allow retry
          if (
            donation.webhookProcessed === true &&
            !donation.receiptGeneratedAt
          ) {
            console.log(
              "⚠️ Webhook flag set but no receipt. Resetting to retry.",
            );
            await donationModle.findByIdAndUpdate(donation._id, {
              $set: { webhookProcessed: false },
            });
          }

          // Update to mark as processing
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

          console.log(
            "✅ Starting webhook processing for donation:",
            donation._id,
          );

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
              "✅ Meta Purchase event processed for donation:",
              donation._id,
            );
          } catch (metaErr) {
            console.error(
              "⚠️ Meta Purchase event error (non-fatal):",
              metaErr.message,
            );
            await donationModle.findByIdAndUpdate(donation._id, {
              $set: { metaPurchaseLastError: String(metaErr.message) },
            });
          }

          // Process receipt and WhatsApp
          if (donation.amount >= 1) {
            console.log(
              "📄 Starting receipt generation for amount:",
              donation.amount,
            );

            try {
              let apiResponse = null;

              // Call BCC API
              try {
                console.log("📞 Calling BCC API...");
                apiResponse = await externalDonationService.sendToExternalApi(
                  donation,
                  payment,
                );
                console.log(
                  "✅ BCC API returned receipt:",
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
                  "⚠️ BCC API error (continuing with fallback):",
                  apiErr.message,
                );
              }

              // Generate PDF receipt
              console.log("📄 Generating PDF...");
              const filePath = await receiptService.generateReceipt(
                donation,
                apiResponse,
              );
              console.log("✅ PDF generated at:", filePath);

              // Send WhatsApp
              const phone = donation.mobile.startsWith("91")
                ? donation.mobile
                : `91${donation.mobile}`;
              console.log("📱 Sending WhatsApp to:", phone);
              const paymentType =
                donation.subscriptionId || donation.isRecurring
                  ? "subscription"
                  : "normal";

              const whatsappResult = await whatsappService.sendReceiptWhatsapp(
                phone,
                filePath,
                donation.name,
                donation.amount,
                paymentType,
              );
              console.log("✅ WhatsApp sent successfully!", whatsappResult);

              // Mark as complete
              await donationModle.findByIdAndUpdate(donation._id, {
                $set: { receiptGeneratedAt: new Date() },
              });

              console.log(
                "🎉 Webhook processing completed successfully for donation:",
                donation._id,
              );
            } catch (error) {
              console.error("❌ Error in receipt generation/WhatsApp:", error);
              await donationModle.findByIdAndUpdate(donation._id, {
                $inc: { receiptGenerationAttempts: 1 },
                $set: {
                  receiptGenerationLastError: String(error.message || error),
                  webhookProcessed: false, // Reset to allow retry
                },
              });
            }
          } else {
            console.log(
              "⚠️ Amount too low for receipt generation:",
              donation.amount,
            );
            // Mark as complete even without receipt
            await donationModle.findByIdAndUpdate(donation._id, {
              $set: { receiptGeneratedAt: new Date() },
            });
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
