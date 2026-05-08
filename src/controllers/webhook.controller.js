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
          console.log("=".repeat(50));
          console.log("💰 Payment captured:", payment.id);
          console.log("📦 Order ID:", payment.order_id);
          console.log("=".repeat(50));

          // First, find the donation to check its state
          let donation = await donationModle.findOne({
            razorpayOrderId: payment.order_id,
          });

          if (!donation) {
            console.log(
              "⚠️ Donation not found for order ID:",
              payment.order_id,
            );
            return res.status(200).send("Donation not found - will retry");
          }

          console.log("📋 Donation found:", donation._id);
          console.log("   Status:", donation.status);
          console.log("   Amount:", donation.amount);
          console.log("   Mobile:", donation.mobile);
          console.log("   webhookProcessed:", donation.webhookProcessed);
          console.log("   receiptGeneratedAt:", donation.receiptGeneratedAt);
          console.log("   donorNumber:", donation.donorNumber);

          // ✅ FIX: Auto-recover stuck webhooks (processing for > 2 minutes)
          if (
            donation.webhookProcessed === true &&
            !donation.receiptGeneratedAt &&
            donation.webhookProcessedAt
          ) {
            const stuckDuration =
              (new Date() - new Date(donation.webhookProcessedAt)) / 1000;
            if (stuckDuration > 120) {
              // More than 2 minutes stuck
              console.log(
                `⚠️ Webhook stuck for ${stuckDuration} seconds. Resetting...`,
              );
              await donationModle.findByIdAndUpdate(donation._id, {
                $set: { webhookProcessed: false },
                $unset: { webhookProcessedAt: "" },
              });
              donation = await donationModle.findById(donation._id);
              console.log("✅ Webhook flag reset, continuing processing...");
            } else {
              console.log(
                `⚠️ Webhook currently processing (${stuckDuration}s). Skipping duplicate.`,
              );
              return res.status(200).send("Already processing");
            }
          }

          // If receipt exists but donorNumber is missing, update it (for old donations)
          if (
            donation.receiptGeneratedAt &&
            !donation.donorNumber &&
            donation.externalApiResponse?.DonorNumber
          ) {
            console.log(
              "✅ Receipt exists but donorNumber missing. Updating...",
            );
            await donationModle.findByIdAndUpdate(donation._id, {
              $set: { donorNumber: donation.externalApiResponse.DonorNumber },
            });
            console.log(
              "✅ Donor number restored:",
              donation.externalApiResponse.DonorNumber,
            );
          }

          // If already has receipt, skip processing
          if (donation.receiptGeneratedAt) {
            console.log("✅ Donation already has receipt. Skipping.");
            return res.status(200).send("Already processed");
          }

          // Check if currently being processed (prevent race condition)
          if (donation.webhookProcessed === true) {
            console.log("⚠️ Webhook already processing. Skipping duplicate.");
            return res.status(200).send("Already processing");
          }

          // Mark as processing
          // Mark as processing
          console.log("🔴 STEP 1: About to call findByIdAndUpdate");
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
          console.log("🔴 STEP 2: findByIdAndUpdate completed");

          console.log("🔴 STEP 3: Checking if donation is null");
          if (!donation) {
            console.error("❌ CRITICAL: Donation became null after update!");
            return res.status(200).send("Update failed - will retry");
          }

          console.log("🔴 STEP 4: About to log starting message");
          console.log(
            "✅ Starting full processing for donation:",
            donation._id,
          );

          console.log("🔴 STEP 5: About to log amount");
          console.log("   Amount:", donation.amount);

          console.log("🔴 STEP 6: About to log mobile");
          console.log("   Mobile:", donation.mobile);

          console.log("🔴 STEP 7: About to call Meta API");
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
                console.log(
                  "✅ Donor Number from BCC:",
                  apiResponse?.DonorNumber,
                );

                await donationModle.findByIdAndUpdate(donation._id, {
                  $set: {
                    externalApiResponse: apiResponse,
                    externalApiSentAt: new Date(),
                    donorNumber: apiResponse?.DonorNumber || "",
                  },
                });
                console.log("✅ External API response saved to database");
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
              let phone = donation.mobile;
              if (!phone.startsWith("91")) phone = `91${phone}`;
              phone = phone.replace(/\D/g, "");

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

              // Mark as complete with receiptGeneratedAt
              await donationModle.findByIdAndUpdate(donation._id, {
                $set: { receiptGeneratedAt: new Date() },
              });

              console.log(
                "🎉 Webhook processing completed successfully for donation:",
                donation._id,
              );
            } catch (error) {
              console.error("❌ Error in receipt generation/WhatsApp:", error);
              console.error("Error stack:", error.stack);
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
            await donationModle.findByIdAndUpdate(donation._id, {
              $set: { receiptGeneratedAt: new Date() },
            });
          }

          console.log(
            "🏁 Webhook processing finished for donation:",
            donation._id,
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
