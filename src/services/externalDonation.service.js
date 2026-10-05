const axios = require("axios");
const { istDateDDMMYYYY } = require("../config/timezone");
require("dotenv").config();

const EXTERNAL_API_URL =
  process.env.EXTERNAL_DONATION_API_URL ||
  "https://vhkmsurabhi.com/api/socialmedia/addDonation";
const EXTERNAL_API_KEY =
  process.env.EXTERNAL_DONATION_API_KEY || "DCCVSKPSM261089F7A3XQ8L2B";

const OFFLINE_MODES = {
  online: Number(process.env.DCC_MODE_ONLINE || 3),
  cash: Number(process.env.DCC_MODE_CASH || 1),
  cheque: Number(process.env.DCC_MODE_CHEQUE || 2),
  upi: Number(process.env.DCC_MODE_UPI || 3),
  phonepe: Number(process.env.DCC_MODE_UPI || 3),
  bank_transfer: Number(process.env.DCC_MODE_BANK || 4),
  other: Number(process.env.DCC_MODE_ONLINE || 3),
};

const sendToExternalApi = async (donation, payment = {}) => {
  try {
    const normalizePhone = (raw) => {
      if (!raw) return null;
      const digits = String(raw).replace(/\D/g, "");
      if (digits.length === 12 && digits.startsWith("91"))
        return digits.slice(2);
      if (digits.length > 10) return digits.slice(-10);
      return digits;
    };

    const normalizedPhone = normalizePhone(
      donation.mobile || donation.phone || donation.donorPhone || null,
    );

    const payload = {
      donorName: donation.name || null,
      donorPhone: normalizedPhone,
      donorEmail: donation.email || null,
      gender: null,
      address: {
        fullAddress: donation.address || null,
        state: donation.state || null,
        city: donation.city || null,
        pinCode: donation.pincode || null,
      },
      PAN: donation.panNumber || null,
      amount: String(donation.amount || 0),
      accountType: 4,
      sevaCategory: 1,
      sevaSubCategory: 1,
      sevaSubCategoryCode: null,
      // How the money was paid, for an offline donation. It was always 3
      // (online), so DCC recorded every cash and cheque donation entered in
      // DRM or on this site's admin form as an online payment. Same codes and
      // env names as the main site's dcc.service.js.
      modeOfPayment:
        donation.donationSource === "offline"
          ? OFFLINE_MODES[donation.offlinePaymentMode] ?? OFFLINE_MODES.online
          : OFFLINE_MODES.online,
      gatewayPaymentId: payment.id || donation.razorpayPaymentId || null,
      // The date DCC files this donation under, and therefore which financial
      // year it lands in and which receipt-number series it draws from.
      //
      // This was toLocaleDateString("en-GB") with no timezone, so it formatted
      // the UTC day. A donation taken between midnight and 5:30am IST on
      // 1 April formatted as 31 March and was filed by DCC in the PREVIOUS
      // financial year, with a receipt number from the wrong series — on a
      // document the donor claims tax relief against. The same shift moved
      // every other 00:00–05:30 IST donation back a day.
      //
      // Pinned to IST explicitly rather than relying on the process TZ, because
      // this value ends up on a legal document and must not depend on an
      // environment setting staying put.
      transactionDate: payment.created_at
        ? istDateDDMMYYYY(new Date(payment.created_at * 1000))
        : donation.createdAt
          ? istDateDDMMYYYY(new Date(donation.createdAt))
          : null,
      // Who DCC records as having enrolled this donation.
      //
      // The preacher who brought the donor in, when DRM told us who that was,
      // and the temple's generic default otherwise. A hardcoded 36 meant every
      // donation - including the ones a named preacher had spent a year
      // building a relationship for - was credited to nobody in DCC's books.
      //
      // Required by DCC and capped at three digits, so an id that cannot be a
      // real one falls back rather than failing the call.
      enrolledBy:
        Number.isFinite(Number(donation.dccEnrolledById)) &&
        donation.dccEnrolledById != null &&
        Number(donation.dccEnrolledById) > 0 &&
        Number(donation.dccEnrolledById) < 1000
          ? Number(donation.dccEnrolledById)
          : 36,
    };

    console.log(
      "📤 External API: sending payload for donation",
      donation._id || donation.name,
    );
    console.log("Payload:", JSON.stringify(payload, null, 2));

    const headers = {
      "DCC-Api-Key": EXTERNAL_API_KEY,
      "Content-Type": "application/json",
    };

    const resp = await axios.post(EXTERNAL_API_URL, payload, {
      headers,
      timeout: 30000, // 30s — DCC can be slow on busy days
    });

    console.log("✅ External API Response Status:", resp.status);
    console.log("📋 Response Data:", resp.data);

    if (resp.data && (resp.data.ReceiptNumber || resp.data.DonationId)) {
      console.log("🎯 Important fields from API:");
      console.log("   ReceiptNumber:", resp.data.ReceiptNumber);
      console.log("   DonationId:", resp.data.DonationId);
      console.log("   DonorNumber:", resp.data.DonorNumber);
      console.log("   IsNewDonor:", resp.data.IsNewDonor);
    }

    return resp.data;
  } catch (error) {
    if (error.code === "ECONNABORTED" || error.message?.includes("timeout")) {
      // DCC timed out on our end — but DCC server may have still processed the donation.
      // Throw a special error so callers can treat this as "unknown" not "definitely failed".
      console.error("⏱️ DCC API timeout — DCC may have still processed. Use Missing Receipts to verify.");
      const timeoutErr = new Error("DCC_TIMEOUT: Request timed out — DCC may have processed. Check via Missing Receipts.");
      timeoutErr.isDCCTimeout = true;
      throw timeoutErr;
    }
    if (error.response) {
      const msg = error.response.data?.Message || error.response.data?.message || "";
      // DCC returns 400 when payment already exists — treat as success
      if (error.response.status === 400 && msg.toLowerCase().includes("transaction details exist")) {
        console.log("✅ DCC: Transaction already exists — treating as registered.");
        return { alreadyExists: true, Message: msg };
      }
      console.error("❌ External API call failed with status:", error.response.status);
      console.error("Error response:", error.response.data);
    } else {
      console.error("❌ External API call failed:", error.message);
    }
    throw error;
  }
};

module.exports = { sendToExternalApi };
