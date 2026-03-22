const mongoose = require("mongoose");

const donationSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: false },
    mobile: { type: String, required: true },
  occasion: { type: String, required: false },
  sevaDate: { type: String, required: false },

  dob: { type: String, required: true },
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
    prasadamAddressOption: { type: String, enum: ['same', 'different'], default: 'same' },
    prasadamAddress: String,

    receiptNumber: { type: Number },
    receiptGeneratedAt: { type: Date },

    subscriptionId: String,
    isRecurring: {
      type: Boolean,
      default: false,
    },

     utm:{
  source: String,
  medium: String,
  campaign: String,
  content: String,
  term: String
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
