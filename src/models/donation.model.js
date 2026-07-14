const mongoose = require("mongoose");

const donationSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: false },
    mobile: { type: String, required: true },
    occasion: { type: String, required: false },
    sevaDate: { type: String, required: false },

    dob: { type: String, required: false },
    lastBirthdayWishSentYear: { type: Number },
    lastAnniversaryWishSentYear: { type: Number },
    amount: { type: Number, required: true },
    razorpayOrderId: String,
    razorpayPaymentId: String,

    certificate: { type: Boolean, default: false },
    panNumber: String,
    address: String,
    city: String,
    state: String,
    pincode: String,

    mahaprasadam: { type: Boolean, default: false },
    prasadamAddressOption: {
      type: String,
      enum: ["same", "different"],
      default: "same",
    },
    prasadamAddress: String,
    prasadamName: String,
    prasadamMobile: String,
    prasadamCity: String,
    prasadamState: String,
    prasadamPincode: String,
    prasadamDeliveryStatus: { type: String, enum: ["pending", "delivered"], default: "pending" },
    prasadamDeliveredAt: { type: Date },
    prasadamWhatsappSentAt: { type: Date },
    prasadamTrackingNumber: { type: String },

    receiptNumber: { type: String },
    donorNumber: { type: String, default: "" },
    receiptGeneratedAt: { type: Date },
    externalApiResponse: { type: Object },
    externalApiSentAt: { type: Date },
    fbp: { type: String },
    fbc: { type: String },
    clientIp: { type: String },
    userAgent: { type: String },
    pageUrl: { type: String },
    metaPurchaseResponse: { type: Object },
    metaPurchaseSentAt: { type: Date },
    metaPurchaseLastError: { type: String },
    receiptGenerationAttempts: { type: Number, default: 0 },
    receiptGenerationLastError: { type: String },

    subscriptionId: String,
    isRecurring: {
      type: Boolean,
      default: false,
    },

    utm: {
      source: String,
      medium: String,
      campaign: String,
      content: String,
      term: String,
    },

    status: {
      type: String,
      enum: [
        "created",
        "active",
        "paid",
        "pending",
        "halted",
        "cancelled",
        "completed",
      ],
      default: "created",
    },
    failureCount: {
      type: Number,
      default: 0,
    },
    whatsappPendingReminderSent: {
      type: Boolean,
      default: false,
    },
    reviewAfter: Date,
    lastPaymentDate: Date,

    webhookProcessedAt: { type: Date },
    webhookProcessed: { type: Boolean, default: false },

    donationSource: { type: String, enum: ["online", "offline"], default: "online" },
    offlineRefNo: { type: String },
    offlinePaymentMode: { type: String, enum: ["phonepe", "bank_transfer", "cash", "cheque", "upi", "other"] },
    sevakName: { type: String, default: "" },
    sevakMobile: { type: String, default: "" }, // honoree's mobile — if set, wish goes to them; else goes to donor
    showInTransactions: { type: Boolean, default: true },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);
donationSchema.index({ razorpayOrderId: 1 }, { unique: true, sparse: true });
donationSchema.index({ razorpayPaymentId: 1 }, { unique: true, sparse: true });
donationSchema.index({ receiptGeneratedAt: 1 });

const donationModle = mongoose.model("Donation", donationSchema);

module.exports = { donationModle };
