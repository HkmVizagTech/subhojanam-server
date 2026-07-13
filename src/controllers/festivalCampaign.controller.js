const FestivalCampaign = require("../models/festivalCampaign.model");
const Campaign = require("../models/campaign.model");
const cloudinary = require("../config/cloudinary");

function normalizeCampaignKey(name) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function uploadBufferToCloudinary(buffer, folder) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder, resource_type: "image" },
      (error, result) => {
        if (error) reject(error);
        else resolve(result);
      }
    );
    stream.end(buffer);
  });
}

const festivalCampaignController = {
  // Admin: create a new festival campaign with desktop + mobile banner images
  createFestivalCampaign: async (req, res) => {
    try {
      const { name, utmCampaign, linkUrl } = req.body;

      if (!name || !utmCampaign) {
        return res.status(400).json({ success: false, message: "Name and UTM campaign key are required" });
      }

      if (!req.files || !req.files.desktopImage || !req.files.mobileImage) {
        return res.status(400).json({ success: false, message: "Both desktop and mobile images are required" });
      }

      const key = normalizeCampaignKey(utmCampaign);

      const existing = await FestivalCampaign.findOne({ utmCampaign: key });
      if (existing) {
        return res.status(409).json({ success: false, message: `Campaign "${key}" already exists` });
      }

      const [desktopResult, mobileResult] = await Promise.all([
        uploadBufferToCloudinary(req.files.desktopImage[0].buffer, "festival-banners/desktop"),
        uploadBufferToCloudinary(req.files.mobileImage[0].buffer, "festival-banners/mobile"),
      ]);

      const campaign = await FestivalCampaign.create({
        name,
        utmCampaign: key,
        desktopImageUrl: desktopResult.secure_url,
        mobileImageUrl: mobileResult.secure_url,
        linkUrl: linkUrl || "#donate",
        isActive: true,
      });

      const baseUrl = process.env.CAMPAIGN_BASE_URL || "https://annadan.harekrishnavizag.org";
      const generatedUrl = `${baseUrl}?utm_source=meta&utm_medium=paid_social&utm_campaign=${encodeURIComponent(key)}`;

      // Also register in the shared Campaign model so it shows up in
      // the existing Campaign list / UTM tracking view alongside regular campaigns.
      try {
        const existingCampaignEntry = await Campaign.findOne({ "utm.campaign": key });
        if (!existingCampaignEntry) {
          await Campaign.create({
            name: `🪔 ${name}`,
            utm: {
              source: "meta",
              medium: "paid_social",
              campaign: key,
            },
            generatedUrl,
          });
        }
      } catch (campaignRegErr) {
        console.error("Could not register festival campaign in Campaign model:", campaignRegErr.message);
        // Non-fatal — festival banner still works even if this fails
      }

      res.status(201).json({ success: true, campaign, generatedUrl });
    } catch (error) {
      console.error("Create festival campaign error:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  },

  // Admin: list all campaigns
  listFestivalCampaigns: async (req, res) => {
    try {
      const campaigns = await FestivalCampaign.find().sort({ createdAt: -1 });
      res.json({ success: true, campaigns });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  },

  // Admin: update name and/or replace images (utmCampaign key stays fixed to protect running ads)
  updateFestivalCampaign: async (req, res) => {
    try {
      const { id } = req.params;
      const { name, linkUrl } = req.body;

      const campaign = await FestivalCampaign.findById(id);
      if (!campaign) return res.status(404).json({ success: false, message: "Not found" });

      if (name) campaign.name = name;
      if (linkUrl) campaign.linkUrl = linkUrl;

      if (req.files?.desktopImage?.[0]) {
        const result = await uploadBufferToCloudinary(req.files.desktopImage[0].buffer, "festival-banners/desktop");
        campaign.desktopImageUrl = result.secure_url;
      }
      if (req.files?.mobileImage?.[0]) {
        const result = await uploadBufferToCloudinary(req.files.mobileImage[0].buffer, "festival-banners/mobile");
        campaign.mobileImageUrl = result.secure_url;
      }

      await campaign.save();

      // Keep the shared Campaign registry name in sync
      if (name) {
        try {
          await Campaign.findOneAndUpdate(
            { "utm.campaign": campaign.utmCampaign },
            { name: `🪔 ${name}` }
          );
        } catch (e) {
          console.error("Could not sync name to Campaign registry:", e.message);
        }
      }

      res.json({ success: true, campaign });
    } catch (error) {
      console.error("Update festival campaign error:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  },

  // Admin: toggle active/inactive
  toggleFestivalCampaign: async (req, res) => {
    try {
      const { id } = req.params;
      const campaign = await FestivalCampaign.findById(id);
      if (!campaign) return res.status(404).json({ success: false, message: "Not found" });
      campaign.isActive = !campaign.isActive;
      await campaign.save();
      res.json({ success: true, campaign });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  },

  // Admin: delete
  deleteFestivalCampaign: async (req, res) => {
    try {
      const { id } = req.params;
      const deleted = await FestivalCampaign.findByIdAndDelete(id);
      if (!deleted) return res.status(404).json({ success: false, message: "Not found" });

      // Also remove from shared Campaign registry, if present
      try {
        await Campaign.findOneAndDelete({ "utm.campaign": deleted.utmCampaign });
      } catch (e) {
        console.error("Could not clean up Campaign registry entry:", e.message);
      }

      res.json({ success: true, message: "Deleted" });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  },

  // PUBLIC: fetch active campaign banner by utm_campaign key — used by the donation page
  getCampaignByUtm: async (req, res) => {
    try {
      const { utmCampaign } = req.query;
      if (!utmCampaign) {
        return res.json({ success: true, campaign: null });
      }
      const key = normalizeCampaignKey(utmCampaign);
      const campaign = await FestivalCampaign.findOne({ utmCampaign: key, isActive: true });
      res.json({ success: true, campaign: campaign || null });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  },
};

module.exports = { festivalCampaignController };
