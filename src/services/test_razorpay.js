// test_razorpay.js - Updated version
const path = require("path");
const Razorpay = require("razorpay");

// Load .env.local from server root (2 levels up)
require("dotenv").config({
  path: path.join(__dirname, "../../.env.local"),
});

console.log(
  "Looking for .env.local at:",
  path.join(__dirname, "../../.env.local"),
);
console.log("RAZORPAY_KEY_ID:", process.env.RAZORPAY_KEY_ID);

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

async function test() {
  try {
    console.log("Testing Razorpay connection...");
    const order = await razorpay.orders.create({
      amount: 50000, // ₹500
      currency: "INR",
      receipt: "test_receipt",
    });
    console.log("✅ Razorpay working! Order ID:", order.id);
  } catch (error) {
    console.error(
      "❌ Razorpay error:",
      error.error?.description || error.message,
    );
  }
}

test();
