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
          let donation = null; // ← declare OUTSIDE try so catch can access it

          try {
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
                console.log("✅ BCC API done:", apiResponse?.ReceiptNumber);
              } catch (apiErr) {
                console.error("⚠️ BCC API error:", apiErr.message);
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
              console.log("subscription.charged already processed:", payment.id);
              break;
            }

            // 2. Find original subscription donation to get donor details
            const originalDonation = await donationModle.findOne({
              subscriptionId: payment.subscription_id,
            }).sort({ createdAt: 1 });

            if (!originalDonation) {
              console.error("No original donation found for subscription:", payment.subscription_id);
              break;
            }

            // 3. Create a new donation record for this month's charge
            const newDonation = await donationModle.create({
              name: originalDonation.name,
              email: originalDonation.email,
              mobile: originalDonation.mobile,
              amount: originalDonation.amount,
              certificate: originalDonation.certificate,
              panNumber: originalDonation.panNumber,
              address: originalDonation.address,
              city: originalDonation.city,
              state: originalDonation.state,
              pincode: originalDonation.pincode,
              occasion: originalDonation.occasion,
              mahaprasadam: originalDonation.mahaprasadam,
              prasadamAddressOption: originalDonation.prasadamAddressOption,
              prasadamAddress: originalDonation.prasadamAddress,
              utm: originalDonation.utm,
              fbp: originalDonation.fbp,
              fbc: originalDonation.fbc,
              clientIp: originalDonation.clientIp,
              userAgent: originalDonation.userAgent,
              pageUrl: originalDonation.pageUrl,
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
              try {
                let apiResponse = null;
                try {
                  apiResponse = await externalDonationService.sendToExternalApi(newDonation, payment);
                  await donationModle.findByIdAndUpdate(newDonation._id, {
                    $set: { externalApiResponse: apiResponse, externalApiSentAt: new Date(), donorNumber: apiResponse?.DonorNumber || "" },
                  });
                  console.log("✅ BCC API done for subscription:", apiResponse?.ReceiptNumber);
                } catch (apiErr) {
                  console.error("⚠️ BCC API error for subscription:", apiErr.message);
                }

                const filePath = await receiptService.generateReceipt(newDonation, apiResponse);
                let phone = newDonation.mobile.replace(/\D/g, "");
                if (!phone.startsWith("91")) phone = `91${phone}`;
                await whatsappService.sendReceiptWhatsapp(phone, filePath, newDonation.name, newDonation.amount, "subscription");
                console.log("✅ WhatsApp sent for subscription charge:", payment.id);
              } catch (receiptErr) {
                console.error("Error in subscription receipt/whatsapp:", receiptErr.message);
              }
            }

            // 6. Update original donation's lastPaymentDate
            await donationModle.findByIdAndUpdate(originalDonation._id, {
              $set: { lastPaymentDate: new Date() },
            });

          } catch (subErr) {
            console.error("❌ subscription.charged error:", subErr.message);
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
