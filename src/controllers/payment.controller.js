const { razorpay } = require("../config/razorpay");
const {donationModle} = require("../models/donation.model");
const {planModel} = require("../models/plan.model");
const path = require("path");
const fs = require("fs");
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
      reviewAfter: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000) 
    });

    return res.status(200).send({
      subscriptionId: subscription.id,
      key: process.env.RAZORPAY_KEY_ID
    });

  } catch (error) {
  // console.log("====== SUBSCRIPTION ERROR START ======");
  // console.log("Status Code:", error.statusCode);
  // console.log("Error Description:", error.error?.description);
  // console.log("Full Error Object:", error);
  // console.log("====== SUBSCRIPTION ERROR END ======");

  return res.status(500).json({
    message: "Subscription creation failed",
    error: error.error?.description || error.message
  });
}
},

downloadReceipt: async (req, res) => {
  try {
    const { donationId } = req.params;
    
    console.log("=== DOWNLOAD RECEIPT REQUEST ===");
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
      receiptNumber: donation.receiptNumber,
      receiptGeneratedAt: donation.receiptGeneratedAt
    });
  
    if (!donation.receiptNumber) {
      console.log("ERROR: Receipt number not set - receipt not yet generated");
      return res.status(404).json({ message: "Receipt not yet generated. Please wait a moment and try again." });
    }
    
    const filePath = path.join(__dirname, "../../receipts", `${donationId}.pdf`);
    console.log("Looking for PDF at:", filePath);
    
    if (!fs.existsSync(filePath)) {
      console.log("ERROR: PDF file does not exist at path");
      return res.status(404).json({ message: "Receipt file not found" });
    }
    
    console.log("SUCCESS: Sending PDF file");
    res.download(filePath, `Receipt_${donation.receiptNumber}.pdf`, (err) => {
      if (err) {
        console.error("Error downloading receipt:", err);
        if (!res.headersSent) {
          res.status(500).json({ message: "Error downloading receipt" });
        }
      } else {
        console.log("Download completed successfully");
      }
    });
    
  } catch (error) {
    console.error("Download receipt error:", error);
    res.status(500).json({ message: "Failed to download receipt" });
  }
}


}


module.exports = { paymentController}