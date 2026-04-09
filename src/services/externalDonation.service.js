const axios = require('axios');
require('dotenv').config();

const EXTERNAL_API_URL = process.env.EXTERNAL_DONATION_API_URL || 'https://vhkmsurabhi.com/api/socialmedia/addDonation';
const EXTERNAL_API_KEY = process.env.EXTERNAL_DONATION_API_KEY || 'DCCVSKPSM261089F7A3XQ8L2B';

const sendToExternalApi = async (donation, payment = {}) => {
  try {
    
    const normalizePhone = (raw) => {
      if (!raw) return null;
      const digits = String(raw).replace(/\D/g, '');
      if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
      if (digits.length > 10) return digits.slice(-10);
      return digits;
    };

    const normalizedPhone = normalizePhone(donation.mobile || donation.phone || donation.donorPhone || null);
    const payload = {
      donorName: donation.name || null,
      donorPhone: normalizedPhone,
      donorEmail: donation.email || null,
      gender: null,
      address: {
        fullAddress: donation.address || null,
        state: donation.state || null,
        city: donation.city || null,
        pinCode: donation.pincode || null
      },
      PAN: donation.panNumber || null,
      amount: String(donation.amount || 0),
      accountType: 4,
      sevaCategory: 1,
      sevaSubCategory: 1,
      sevaSubCategoryCode: null,
      modeOfPayment: 3,
      gatewayPaymentId: payment.id || donation.razorpayPaymentId || null,
      transactionDate: payment.created_at ? new Date(payment.created_at * 1000).toLocaleDateString('en-GB') : (donation.createdAt ? new Date(donation.createdAt).toLocaleDateString('en-GB') : null)
    };

    
    console.log('External API: sending payload for donation', donation._id || donation.name, {
      donorName: payload.donorName,
      donorPhone: payload.donorPhone,
      gatewayPaymentId: payload.gatewayPaymentId,
      amount: payload.amount,
      normalizedPhone
    });

    const headers = {
      'DCC-Api-Key': EXTERNAL_API_KEY,
      'Content-Type': 'application/json'
    };

    const resp = await axios.post(EXTERNAL_API_URL, payload, { headers, timeout: 10000 });
    // Log a compact version of the response
    try {
      console.log('External API: response status for donation', donation._id || donation.name, resp.status);
      console.log('External API: response keys for donation', donation._id || donation.name, Object.keys(resp.data || {}));
      // If typical fields exist, log them
      if (resp.data && (resp.data.ReceiptNumber || resp.data.DonationId)) {
        console.log('External API: important fields:', {
          ReceiptNumber: resp.data.ReceiptNumber,
          DonationId: resp.data.DonationId,
          DonorNumber: resp.data.DonorNumber
        });
      }
    } catch (e) {
      console.warn('External API: failed to log response details', e.message || e);
    }

    return resp.data;
  } catch (error) {
    // Improve error logs: include status and response body when available
    if (error.response) {
      try {
        console.error('External API call failed with status', error.response.status, 'body keys:', Object.keys(error.response.data || {}));
        console.error('External API response body preview:', JSON.stringify(error.response.data).slice(0, 1000));
      } catch (e) {
        console.error("External API call failed - couldn't stringify response body", e.message || e);
      }
    } else {
      console.error('External API call failed:', error.message || error);
    }
    // Rethrow to let caller decide whether to treat as fatal
    throw error;
  }
};

module.exports = { sendToExternalApi };
