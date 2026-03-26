// Temporary admin debug endpoint to count UTM-tagged and non-UTM donations
const express = require('express');
const router = express.Router();
const { donationModle } = require('../models/donation.model');

// GET /api/admin/debug-utm-count
router.get('/debug-utm-count', async (req, res) => {
  try {
    const utmCount = await donationModle.countDocuments({ 'utm.campaign': { $exists: true, $ne: null, $ne: '' }, status: 'paid' });
    const nonUtmCount = await donationModle.countDocuments({ $or: [ { utm: { $exists: false } }, { 'utm.campaign': { $in: [null, ''] } } ], status: 'paid' });
    res.json({ success: true, utmCount, nonUtmCount });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
