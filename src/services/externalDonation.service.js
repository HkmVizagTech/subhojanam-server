const axios = require("axios");
require("dotenv").config();

const EXTERNAL_API_URL =
  process.env.EXTERNAL_DONATION_API_URL ||
  "https://vhkmsurabhi.com/api/socialmedia/addDonation";
const EXTERNAL_API_KEY =
  process.env.EXTERNAL_DONATION_API_KEY || "DCCVSKPSM261089F7A3XQ8L2B";

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
      modeOfPayment: 3,
      gatewayPaymentId: payment.id || donation.razorpayPaymentId || null,
      transactionDate: payment.created_at
        ? new Date(payment.created_at * 1000).toLocaleDateString("en-GB")
        : donation.createdAt
          ? new Date(donation.createdAt).toLocaleDateString("en-GB")
          : null,
      enrolledBy: 36, // 🔑 CRITICAL FIX: Required field (max 3 digits)
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
      timeout: 10000,
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
    if (error.response) {
      console.error(
        "❌ External API call failed with status:",
        error.response.status,
      );
      console.error("Error response:", error.response.data);
    } else {
      console.error("❌ External API call failed:", error.message);
    }
    throw error;
  }
};

module.exports = { sendToExternalApi };
