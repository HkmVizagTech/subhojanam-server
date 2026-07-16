const mongoose = require("mongoose");

const festivalCampaignSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    utmCampaign: { type: String, required: true, unique: true, index: true },
    desktopImageUrl: { type: String, required: true },
    mobileImageUrl: { type: String, required: true },
    linkUrl: { type: String, default: "#donate" },
    minDonationAmount: { type: Number, default: 100 },
    theme: {
      primaryColor: { type: String, default: "#0A97EF" },   // buttons, headings, borders
      accentColor:  { type: String, default: "#2196f3" },   // gradient pair for buttons
      bgColor:      { type: String, default: "#FEF2E1" },   // donation section background
    },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("FestivalCampaign", festivalCampaignSchema);
