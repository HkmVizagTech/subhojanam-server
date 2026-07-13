const mongoose = require("mongoose");

const festivalCampaignSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    utmCampaign: { type: String, required: true, unique: true, index: true },
    desktopImageUrl: { type: String, required: true },
    mobileImageUrl: { type: String, required: true },
    linkUrl: { type: String, default: "#donate" },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("FestivalCampaign", festivalCampaignSchema);
