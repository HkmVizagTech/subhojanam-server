const express = require("express");
const { festivalCampaignController } = require("../controllers/festivalCampaign.controller");

const publicRouter = express.Router();

// Public — no auth. Used by the donation page to fetch the active
// festival banner (if any) matching the visitor's utm_campaign.
publicRouter.get("/festival-campaign", festivalCampaignController.getCampaignByUtm);

module.exports = { publicRouter };
