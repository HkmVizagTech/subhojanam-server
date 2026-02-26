const { razorpay } = require("../config/razorpay");
const {donationModle} = require("../models/donation.model");
const {planModel} = require("../models/plan.model")
require("dotenv").config()
const paymentController = {
  createOrder : async(req,res)=>{
    try {
        const {  name,email,mobile,occasion,sevaDate,dob,amount} = req.body;

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
      razorpayOrderId:order.id
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
      amount
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
      subscriptionId: subscription.id,
      isRecurring: true,
      status: "created",
      failureCount: 0,
      reviewAfter: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000) 
    });

    return res.status(200).send({
      subscriptionId: subscription.id,
      key: process.env.RAZORPAY_KEY_ID
    });

  } catch (error) {
    // console.log("====== SUBSCRIPTION ERROR START ======");
    console.log("Status Code:", error.statusCode);
    console.log("Error Description:", error.error?.description);
    // console.log("Full Error Object:", error);
    // console.log("====== SUBSCRIPTION ERROR END ======");

    return res.status(500).json({
      message: "Subscription creation failed",
      error: error.error?.description || error.message
    });
  }
}


}


module.exports = { paymentController}