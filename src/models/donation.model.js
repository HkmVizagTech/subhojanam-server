const mongoose = require("mongoose");

const donationSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true },
    mobile: { type: String, required: true },
    occasion: { type: String, required: true },
    dob: { type: String, required: true },
    amount: { type: Number, required: true },
    razorpayOrderId: String,
    razorpayPaymentId: String,

    subscriptionId: String,
    isRecurring: {
      type: Boolean,
      default: false,
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
    reviewAfter: Date,
    lastPaymentDate: Date,
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

const donationModle = mongoose.model("Donation", donationSchema);

module.exports = { donationModle };
