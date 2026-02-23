const express = require("express");
const { webHookControler } = require("../controllers/webhook.controller");

const webHookRouter = express.Router();
webHookRouter.post(
  "/razorpay",
  express.raw({ type: "application/json" }),
  webHookControler.webhook
);


module.exports = { webHookRouter };
