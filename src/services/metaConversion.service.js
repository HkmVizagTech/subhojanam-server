const axios = require("axios");
const crypto = require("crypto");

const DEFAULT_EVENT_SOURCE_URL = "https://annadan.harekrishnavizag.org/";
const DEFAULT_GRAPH_API_VERSION = "v23.0";

function hash(value) {
  if (!value) return undefined;
  return crypto.createHash("sha256").update(String(value).trim().toLowerCase()).digest("hex");
}

function normalizePhone(mobile) {
  if (!mobile) return undefined;
  const digits = String(mobile).replace(/\D/g, "");
  if (!digits) return undefined;
  return digits.startsWith("91") ? digits : `91${digits}`;
}

function buildUserData(donation) {
  const userData = {
    external_id: hash(String(donation._id)),
    country: [hash("in")], // India — always applicable
  };

  // Email + phone
  const emailHash = hash(donation.email);
  const phoneHash = hash(normalizePhone(donation.mobile));
  if (emailHash) userData.em = [emailHash];
  if (phoneHash) userData.ph = [phoneHash];

  // Name — split into first and last
  if (donation.name) {
    const parts = donation.name.trim().split(/\s+/);
    const firstName = parts[0];
    const lastName = parts.length > 1 ? parts.slice(1).join(" ") : "";
    if (firstName) userData.fn = [hash(firstName.toLowerCase())];
    if (lastName) userData.ln = [hash(lastName.toLowerCase())];
  }

  // Address
  if (donation.city) userData.ct = [hash(donation.city.toLowerCase().replace(/\s+/g, ""))];
  if (donation.state) userData.st = [hash(donation.state.toLowerCase().replace(/\s+/g, ""))];
  if (donation.pincode) userData.zp = [hash(donation.pincode.trim())];

  // Date of birth — YYYYMMDD format
  if (donation.dob) {
    const dob = donation.dob.replace(/-/g, "");
    if (dob.length === 8) userData.db = [hash(dob)];
  }

  // Browser IDs — fbp and fbc
  if (donation.fbp) userData.fbp = donation.fbp;  // NOT hashed per Meta spec
  if (donation.fbc) userData.fbc = donation.fbc;  // NOT hashed per Meta spec

  // IP + user agent
  if (donation.clientIp) {
    const ip = donation.clientIp.startsWith("::ffff:")
      ? donation.clientIp.replace("::ffff:", "")
      : donation.clientIp;
    userData.client_ip_address = ip;
  }
  if (donation.userAgent) userData.client_user_agent = donation.userAgent;

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
  const eventSourceUrl = donation.pageUrl || process.env.META_EVENT_SOURCE_URL || DEFAULT_EVENT_SOURCE_URL;
  const paymentId = payment?.id || donation.razorpayPaymentId || String(donation._id);

  // Ensure value is always a clean number
  const value = parseFloat(Number(donation.amount).toFixed(2)) || 0;

  const userData = buildUserData(donation);
  const eventTime = Math.floor(Date.now() / 1000);

  const payload = {
    data: [
      {
        event_name: "Purchase",
        event_time: eventTime,
        event_id: paymentId,
        action_source: "website",
        event_source_url: eventSourceUrl,
        user_data: userData,
        custom_data: {
          currency: "INR",
          value,
          content_name: "Annadana Seva",
          content_type: "product",  // Meta spec requires "product" for Purchase
          content_ids: [paymentId],
          content_category: "religious_charity",
          num_items: Math.floor(value / 25) || 1,
          order_id: donation.razorpayOrderId || paymentId,
        },
      },
      {
        event_name: "Donate",
        event_time: eventTime,
        event_id: `donate_${paymentId}`,
        action_source: "website",
        event_source_url: eventSourceUrl,
        user_data: userData,
        custom_data: {
          currency: "INR",
          value,
          content_name: "Annadana Seva",
          content_category: "religious_charity",
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
    timeout: 8000,
  });

  return response.data;
}

module.exports = { sendPurchaseEvent };
