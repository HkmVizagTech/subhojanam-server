const { razorpay } = require("../config/razorpay");
const {donationModle} = require("../models/donation.model")
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

    if (amount == 500) {
      planId = process.env.RAZORPAY_PLAN_500;
    } else if (amount == 1000) {
      planId = process.env.RAZORPAY_PLAN_1000;
    } else if (amount == 2500) {
      planId = process.env.RAZORPAY_PLAN_2500;
    } else if (amount == 5000) {
      planId = process.env.RAZORPAY_PLAN_5000;
    } else {
      return res.status(400).send("Invalid recurring amount");
    }

    if (!planId) {
      return res.status(500).send("Plan ID not configured properly");
    }

    const subscription = await razorpay.subscriptions.create({
      plan_id: planId,
      customer_notify: 1,
      total_count: 12
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
      status: "created"
    });

    return res.status(200).send({
      subscriptionId: subscription.id,
      key: process.env.RAZORPAY_KEY_ID
    });

  } catch (error) {
    console.error("Subscription Error:", error);
    return res.status(500).send("Subscription creation failed");
  }
}


}


module.exports = { paymentController}