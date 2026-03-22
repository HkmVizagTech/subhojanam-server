const { razorpay } = require("../config/razorpay");
const {donationModle} = require("../models/donation.model");
const {planModel} = require("../models/plan.model");
const path = require("path");
const fs = require("fs");
const { generateReceipt } = require("../services/receipt.service");
require("dotenv").config()
const paymentController = {
  createOrder : async(req,res)=>{
    try {
        const {  name, email, mobile, occasion, sevaDate, dob, amount, certificate, panNumber, address, city, state, pincode, mahaprasadam, prasadamAddressOption, prasadamAddress } = req.body;

  if (!amount || amount < 1) {
  return res.status(400).send("Invalid amount");
}


    const options = {
      amount: amount * 100,
      currency: "INR",
      receipt: `receipt_${Date.now()}`,
      payment_capture: 1
    };

    const order = await razorpay.orders.create(options);

    const donation = await donationModle.create({
      name,
      email,
      mobile,
      occasion,
      sevaDate,
      dob,
      amount,
      certificate,
      panNumber,
      address,
      city,
      state,
      pincode,
      mahaprasadam,
      prasadamAddressOption,
      prasadamAddress,
      razorpayOrderId:order.id,
      ...(req.body.utm ? { utm: req.body.utm } : {})
    })

    return res.status(200).send({
      orderId: order.id,
      key: process.env.RAZORPAY_KEY_ID,
      donationId: donation._id
    })

    } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Order creation failed" });
    }
  },


 createSubscription: async (req, res) => {
  try {
    const {
      name,
      email,
      mobile,
      occasion,
      sevaDate,
      dob,
      amount,
      certificate,
      panNumber,
      address,
      city,
      state,
      pincode,
      mahaprasadam,
      prasadamAddressOption,
      prasadamAddress
    } = req.body;

    if (!amount || amount < 1) {
      return res.status(400).send("Invalid amount");
    }

    let planId;

console.log("Using KEY:", process.env.RAZORPAY_KEY_ID);
console.log("Using PLAN ID:", planId);

    if (amount == 500) {
      planId = process.env.RAZORPAY_PLAN_500;
    } else if (amount == 1000) {
      planId = process.env.RAZORPAY_PLAN_1000;
    } else if (amount == 2500) {
      planId = process.env.RAZORPAY_PLAN_2500;
    } else if (amount == 5000) {
      planId = process.env.RAZORPAY_PLAN_5000;
    } else {

     

      
      const existingPlan = await planModel.findOne({ amount });

      if (existingPlan) {
        planId = existingPlan.planId;
      } else {

        const newPlan = await razorpay.plans.create({
          period: "monthly",
          interval: 1,
          item: {
            name: `Monthly Donation ₹${amount}`,
            amount: amount * 100,
            currency: "INR"
          }
        });

        planId = newPlan.id;


        await planModel.create({
          amount,
          planId
        });
      }
    }

    if (!planId) {
      return res.status(500).send("Plan creation failed");
    }


    const subscription = await razorpay.subscriptions.create({
      plan_id: planId,
      customer_notify: 0,
      total_count: 12,
      quantity: 1
    });

    await donationModle.create({
      name,
      email,
      mobile,
      occasion,
      sevaDate,
      dob,
      amount,
      certificate,
      panNumber,
      address,
      city,
      state,
      pincode,
      mahaprasadam,
      prasadamAddressOption,
      prasadamAddress,
      subscriptionId: subscription.id,
      isRecurring: true,
      status: "created",
      failureCount: 0,
      reviewAfter: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
      ...(req.body.utm ? { utm: req.body.utm } : {})
    });

    return res.status(200).send({
      subscriptionId: subscription.id,
      key: process.env.RAZORPAY_KEY_ID
    });

  } catch (error) {
  return res.status(500).json({
    message: "Subscription creation failed",
    error: error.error?.description || error.message
  });
}
},

downloadReceipt: async (req, res) => {
  try {
    const { donationId } = req.params;
    
    console.log("=== GET RECEIPT DATA REQUEST ===");
    console.log("Donation ID:", donationId);
    
    const donation = await donationModle.findById(donationId);
    
    if (!donation) {
      console.log("ERROR: Donation not found in database");
      return res.status(404).json({ message: "Donation not found" });
    }
    
    console.log("Donation found:", {
      id: donation._id,
      name: donation.name,
      amount: donation.amount,
      status: donation.status,
      receiptNumber: donation.receiptNumber
    });
  
    if (!donation.receiptNumber) {
      console.log("ERROR: Receipt number not set - not eligible for receipt");
      return res.status(404).json({ message: "This donation does not have a receipt number assigned." });
    }
    
    const receiptData = {
      receiptNumber: donation.receiptNumber,
      name: donation.name,
      email: donation.email,
      mobile: donation.mobile,
      amount: donation.amount,
      address: donation.address,
      city: donation.city,
      state: donation.state,
      pincode: donation.pincode,
      panNumber: donation.panNumber,
      certificate: donation.certificate,
      razorpayPaymentId: donation.razorpayPaymentId,
      receiptGeneratedAt: donation.receiptGeneratedAt,
      createdAt: donation.createdAt
    };
    
    console.log("SUCCESS: Sending receipt data");
    return res.status(200).json({
      success: true,
      data: receiptData
    });
    
  } catch (error) {
    console.error("Get receipt data error:", error);
    res.status(500).json({ message: "Failed to fetch receipt data" });
  }
}


}


module.exports = { paymentController}