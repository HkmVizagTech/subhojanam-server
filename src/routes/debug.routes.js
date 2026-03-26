// Temporary admin debug endpoint to list recent donations with UTM fields
const express = require('express');
const router = express.Router();
const { donationModle } = require('../models/donation.model');

// GET /api/admin/debug-donations
router.get('/debug-donations', async (req, res) => {
  try {
    const donations = await donationModle.find({}, {
      name: 1, email: 1, amount: 1, status: 1, utm: 1, createdAt: 1
    }).sort({ createdAt: -1 }).limit(20);
    res.json({ success: true, donations });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
