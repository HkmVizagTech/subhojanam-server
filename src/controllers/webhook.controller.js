const crypto = require("crypto");
const { donationModle } = require("../models/donation.model");
const receiptService = require("../services/receipt.service");
const whatsappService = require("../services/whatsapp.service");
// TEMPORARILY DISABLED — do not push/enable until instructed
// const { maybeSendSameDayWish } = require("./wish.controller");
const externalDonationService = require("../services/externalDonation.service");
const metaConversionService = require("../services/metaConversion.service");

const webHookControler = {
  webhook: async (req, res) => {
    try {
      const signature = req.headers["x-razorpay-signature"];
      const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;

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
        console.warn("Webhook signature mismatch — rejecting request");
        return res.status(400).send("Invalid signature");
      }

      const event = JSON.parse(body);
      console.log("Webhook Event:", event.event);

      switch (event.event) {
        case "payment.captured": {
          const payment = event.payload.payment.entity;
          let donation = null; // ← declare OUTSIDE try so catch can access it

          try {
            // Guard — payment must have an order_id, else skip (subscription charges handled separately)
            if (!payment.order_id) {
              console.log("payment.captured: no order_id (likely subscription charge), skipping:", payment.id);
              return res.status(200).send("No order_id — handled by subscription.charged");
            }

            donation = await donationModle.findOne({
              razorpayOrderId: payment.order_id,
            });

            if (!donation) return res.status(200).send("Donation not found");
            if (donation.receiptGeneratedAt)
              return res.status(200).send("Already processed");
            if (donation.webhookProcessed === true) {
              const stuckDuration =
                (new Date() - new Date(donation.webhookProcessedAt)) / 1000;
              if (stuckDuration < 120)
                return res.status(200).send("Already processing");
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

            if (!donation) return res.status(200).send("Update failed");

            metaConversionService
              .sendPurchaseEvent(donation, payment)
              .then((metaResponse) =>
                donationModle.findByIdAndUpdate(donation._id, {
                  $set: {
                    metaPurchaseResponse: metaResponse,
                    metaPurchaseSentAt: new Date(),
                    metaPurchaseLastError: null,
                  },
                }),
              )
              .catch((err) => console.error("⚠️ Meta error:", err.message));

            if (donation.amount >= 1) {
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
                console.log("✅ DCC API done:", apiResponse?.ReceiptNumber);
              } catch (apiErr) {
                console.error("⚠️ DCC API error:", apiErr.message);
                // Don't generate receipt without DCC — Missing Receipts scan will retry
                await donationModle.findByIdAndUpdate(donation._id, {
                  $set: { receiptGenerationLastError: `DCC failed: ${apiErr.message}` },
                });
                return res.status(200).send("DCC failed — will retry via Missing Receipts");
              }

              const filePath = await receiptService.generateReceipt(
                donation,
                apiResponse,
              );
              console.log("✅ PDF generated:", filePath);

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
              console.log("✅ WhatsApp sent");
            }

            // Trigger same-day birthday/anniversary wish if seva date = today
            // TEMPORARILY DISABLED — do not push/enable until instructed
            // maybeSendSameDayWish(donation).catch(err =>
            //   console.error("[Same-day wish] payment.captured error:", err.message)
            // );

            return res.status(200).send("Webhook processed");
          } catch (error) {
            console.error("❌ Webhook error:", error.message);
            if (donation?._id) {
              // ← safe check, donation may still be null
              await donationModle.findByIdAndUpdate(donation._id, {
                $inc: { receiptGenerationAttempts: 1 },
                $set: {
                  receiptGenerationLastError: String(error.message),
                  webhookProcessed: false,
                },
              });
            }
            return res.status(200).send("Webhook error - will retry");
          }
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

          try {
            // 1. Check idempotency — don't process same payment twice
            const alreadyProcessed = await donationModle.findOne({
              razorpayPaymentId: payment.id,
            });
            if (alreadyProcessed) {
              // If donation exists but receipt not generated — retry receipt + WhatsApp
              if (!alreadyProcessed.receiptGeneratedAt && alreadyProcessed.amount >= 1) {
                console.log("subscription.charged: donation exists but no receipt — retrying for:", payment.id);
                let apiResponse = alreadyProcessed.externalApiResponse || null;
                try {
                  if (!apiResponse) {
                    apiResponse = await externalDonationService.sendToExternalApi(alreadyProcessed, payment);
                    await donationModle.findByIdAndUpdate(alreadyProcessed._id, {
                      $set: { externalApiResponse: apiResponse, externalApiSentAt: new Date(), donorNumber: apiResponse?.DonorNumber || "" },
                    });
                  }
                  const filePath = await receiptService.generateReceipt(alreadyProcessed, apiResponse);
                  let phone = alreadyProcessed.mobile.replace(/\D/g, "");
                  if (!phone.startsWith("91")) phone = `91${phone}`;
                  await whatsappService.sendReceiptWhatsapp(phone, filePath, alreadyProcessed.name, alreadyProcessed.amount, "subscription");
                  console.log("✅ Receipt and WhatsApp sent on retry for:", payment.id);
                } catch (retryErr) {
                  console.error("⚠️ Retry receipt failed:", retryErr.message);
                }
              } else {
                console.log("subscription.charged already processed:", payment.id);
              }
              break;
            }

            // 2. Find original subscription donation to get donor details
            // Guard — must have a valid subscription_id
            if (!payment.subscription_id) {
              console.error("subscription.charged: missing subscription_id on payment", payment.id);
              break;
            }

            const originalDonation = await donationModle.findOne({
              subscriptionId: payment.subscription_id,
              isRecurring: true,
            }).sort({ createdAt: 1 });

            if (!originalDonation) {
              console.error("No original donation found for subscription:", payment.subscription_id);
              break;
            }

            // Safety — original must actually belong to this subscription
            if (originalDonation.subscriptionId !== payment.subscription_id) {
              console.error("Subscription ID mismatch — aborting to prevent wrong donor copy:", payment.subscription_id);
              break;
            }

            // 3. Create a new donation record for this month's charge
            const newDonation = await donationModle.create({
              name: originalDonation.name,
              email: originalDonation.email,
              mobile: originalDonation.mobile,
              amount: payment.amount ? payment.amount / 100 : originalDonation.amount,
              certificate: originalDonation.certificate,
              panNumber: originalDonation.panNumber,
              address: originalDonation.address,
              city: originalDonation.city,
              state: originalDonation.state,
              pincode: originalDonation.pincode,
              occasion: originalDonation.occasion,
              sevaDate: originalDonation.sevaDate || "",
              dob: originalDonation.dob || "",
              sevakName: originalDonation.sevakName || "",
              sevakMobile: originalDonation.sevakMobile || "",
              mahaprasadam: originalDonation.mahaprasadam,
              prasadamAddressOption: originalDonation.prasadamAddressOption,
              prasadamAddress: originalDonation.prasadamAddress,
              prasadamName: originalDonation.prasadamName || "",
              prasadamMobile: originalDonation.prasadamMobile || "",
              prasadamCity: originalDonation.prasadamCity || "",
              prasadamState: originalDonation.prasadamState || "",
              prasadamPincode: originalDonation.prasadamPincode || "",
              utm: originalDonation.utm,
              fbp: originalDonation.fbp,
              fbc: originalDonation.fbc,
              clientIp: originalDonation.clientIp,
              userAgent: originalDonation.userAgent,
              pageUrl: originalDonation.pageUrl,
              dob: originalDonation.dob || "",
              sevakMobile: originalDonation.sevakMobile || "",
              sevaDate: originalDonation.sevaDate || "",
              subscriptionId: payment.subscription_id,
              isRecurring: true,
              razorpayPaymentId: payment.id,
              status: "paid",
              failureCount: 0,
              webhookProcessed: true,
              webhookProcessedAt: new Date(),
            });

            // 4. Meta conversion
            try {
              const metaResponse = await metaConversionService.sendPurchaseEvent(newDonation, payment);
              await donationModle.findByIdAndUpdate(newDonation._id, {
                $set: { metaPurchaseResponse: metaResponse, metaPurchaseSentAt: new Date() },
              });
            } catch (metaErr) {
              console.error("Meta error:", metaErr.message);
            }

            // 5. BCC API + Receipt + WhatsApp
            if (newDonation.amount >= 1) {
              let apiResponse = null;

              // 5a. DCC API — if fails, stop here
              try {
                apiResponse = await externalDonationService.sendToExternalApi(newDonation, payment);
                await donationModle.findByIdAndUpdate(newDonation._id, {
                  $set: { externalApiResponse: apiResponse, externalApiSentAt: new Date(), donorNumber: apiResponse?.DonorNumber || "" },
                });
                console.log("✅ BCC API done for subscription:", apiResponse?.ReceiptNumber);
              } catch (apiErr) {
                console.error("⚠️ BCC API error for subscription — skipping receipt and WhatsApp:", apiErr.message);
                break;
              }

              // 5b. Receipt — only if DCC succeeded
              let filePath = null;
              try {
                filePath = await receiptService.generateReceipt(newDonation, apiResponse);
                console.log("✅ Receipt generated for subscription charge:", payment.id);
              } catch (receiptErr) {
                console.error("⚠️ Receipt generation error for subscription:", receiptErr.message);
              }

              // 5c. WhatsApp — only if receipt generated, failure won't affect receipt
              if (filePath) {
                try {
                  let phone = newDonation.mobile.replace(/\D/g, "");
                  if (!phone.startsWith("91")) phone = `91${phone}`;
                  await whatsappService.sendReceiptWhatsapp(phone, filePath, newDonation.name, newDonation.amount, "subscription");
                  console.log("✅ WhatsApp sent for subscription charge:", payment.id);
                } catch (waErr) {
                  console.error("⚠️ WhatsApp error for subscription (receipt already saved):", waErr.message);
                }
              }
            }

            // Trigger same-day birthday/anniversary wish if seva date = today
            // TEMPORARILY DISABLED — do not push/enable until instructed
            // maybeSendSameDayWish(newDonation).catch(err =>
            //   console.error("[Same-day wish] subscription.charged error:", err.message)
            // );

            // 6. Update original donation's lastPaymentDate
            await donationModle.findByIdAndUpdate(originalDonation._id, {
              $set: { lastPaymentDate: new Date() },
            });

          } catch (subErr) {
            console.error("❌ subscription.charged error:", subErr.message);
            console.error("❌ subscription.charged stack:", subErr.stack);
            console.error("❌ subscription.charged payment:", payment?.id, "subscription:", payment?.subscription_id);
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
