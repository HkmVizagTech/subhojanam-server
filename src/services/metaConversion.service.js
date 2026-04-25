const axios = require("axios");
const crypto = require("crypto");

const DEFAULT_EVENT_SOURCE_URL = "https://annadan.harekrishnavizag.org/";
const DEFAULT_GRAPH_API_VERSION = "v23.0";

function hash(value) {
  if (!value) return undefined;
  return crypto
    .createHash("sha256")
    .update(String(value).trim().toLowerCase())
    .digest("hex");
}

function normalizePhone(mobile) {
  if (!mobile) return undefined;

  const digits = String(mobile).replace(/\D/g, "");
  if (!digits) return undefined;

  return digits.startsWith("91") ? digits : `91${digits}`;
}

function buildUserData(donation) {
  const userData = {
    external_id: hash(donation._id),
  };

  const emailHash = hash(donation.email);
  const phoneHash = hash(normalizePhone(donation.mobile));

  if (emailHash) userData.em = [emailHash];
  if (phoneHash) userData.ph = [phoneHash];

  return userData;
}

async function sendPurchaseEvent(donation, payment) {
  if (process.env.META_CAPI_ENABLED === "false") {
    return { skipped: true, reason: "META_CAPI_ENABLED is false" };
  }

  const pixelId = process.env.META_PIXEL_ID;
  const accessToken = process.env.META_ACCESS_TOKEN;

  if (!pixelId || !accessToken) {
    return { skipped: true, reason: "Meta Pixel ID or access token missing" };
  }

  const graphApiVersion = process.env.META_GRAPH_API_VERSION || DEFAULT_GRAPH_API_VERSION;
  const eventSourceUrl = process.env.META_EVENT_SOURCE_URL || DEFAULT_EVENT_SOURCE_URL;
  const paymentId = payment?.id || donation.razorpayPaymentId || String(donation._id);

  const payload = {
    data: [
      {
        event_name: "Purchase",
        event_time: Math.floor(Date.now() / 1000),
        event_id: paymentId,
        action_source: "website",
        event_source_url: eventSourceUrl,
        user_data: buildUserData(donation),
        custom_data: {
          currency: "INR",
          value: Number(donation.amount) || 0,
          content_name: "Annadana Seva",
          content_type: "donation",
          order_id: donation.razorpayOrderId,
        },
      },
    ],
  };

  if (process.env.META_TEST_EVENT_CODE) {
    payload.test_event_code = process.env.META_TEST_EVENT_CODE;
  }

  const url = `https://graph.facebook.com/${graphApiVersion}/${pixelId}/events`;
  const response = await axios.post(url, payload, {
    params: { access_token: accessToken },
    timeout: 5000,
  });

  return response.data;
}

module.exports = { sendPurchaseEvent };
