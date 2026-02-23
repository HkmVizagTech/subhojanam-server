const express = require("express");
const { paymentController } = require("../controllers/payment.controller");

const paymentRouter = express.Router();


paymentRouter.post("/create-order", paymentController.createOrder)
paymentRouter.post("/create-subscription", paymentController.createSubscription)

module.exports = {paymentRouter}