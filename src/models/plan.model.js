
const mongoose = require("mongoose");

const planSchema = new mongoose.Schema({
  amount: { type: Number, required: true, unique: true },
  planId: { type: String, required: true }
}, { timestamps: true });

const planModel = mongoose.model("Plan", planSchema);

module.exports = { planModel };