const mongoose = require("mongoose");

const settingsSchema = new mongoose.Schema({
  organizationName: {
    type: String,
    default: "Subhojanam"
  },
  contactEmail: {
    type: String,
    default: "contact@subhojanam.org"
  },
  contactPhone: {
    type: String,
    default: "+91 12345 67890"
  },
  address: {
    type: String,
    default: "123 Temple Street, Mumbai, Maharashtra 400001"
  },
  minimumDonationAmount: {
    type: Number,
    default: 100
  },
  maximumDonationAmount: {
    type: Number,
    default: 500000
  },
  currency: {
    type: String,
    default: "INR",
    enum: ["INR", "USD"]
  },
  donationGoals: {
    monthlyTarget: {
      type: Number,
      default: 100000
    },
    yearlyTarget: {
      type: Number,
      default: 1200000
    }
  },
  notifications: {
    donationNotifications: {
      type: Boolean,
      default: true
    },
    dailySummary: {
      type: Boolean,
      default: true
    },
    monthlyReports: {
      type: Boolean,
      default: false
    },
    lowInventoryAlert: {
      type: Boolean,
      default: true
    }
  },
  emailTemplate: {
    thankYouTemplate: {
      type: String,
      default: "Dear [Donor Name],\n\nThank you for your generous donation of ₹[Amount]. Your support helps us continue our mission.\n\nBest regards,\nSubhojanam Team"
    },
    autoSend: {
      type: Boolean,
      default: true
    }
  },
  bankDetails: {
    accountName: {
      type: String,
      default: "Subhojanam Trust"
    },
    accountNumber: {
      type: String,
      default: ""
    },
    ifscCode: {
      type: String,
      default: ""
    },
    bankName: {
      type: String,
      default: ""
    },
    branch: {
      type: String,
      default: ""
    }
  },
  receiptSettings: {
    prefix: {
      type: String,
      default: "SUB"
    },
    startNumber: {
      type: Number,
      default: 1000
    },
    includeOrgLogo: {
      type: Boolean,
      default: true
    }
  }
}, {
  timestamps: true,
  versionKey: false
});

const settingsModel = mongoose.model("Settings", settingsSchema);

module.exports = { settingsModel };
