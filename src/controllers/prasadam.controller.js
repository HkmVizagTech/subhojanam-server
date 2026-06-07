const { donationModle } = require("../models/donation.model");
const { sendPrasadamDispatchWhatsapp } = require("../services/whatsapp.service");

const prasadamController = {

  // List all prasadam-opted donations
  getPrasadamList: async (req, res) => {
    try {
      const { page = 1, limit = 20, status = "all", startDate, endDate, search } = req.query;

      const query = {
        mahaprasadam: true,
        status: { $in: ["paid", "active", "completed"] },
      };

      if (status === "pending") query.prasadamDeliveryStatus = { $ne: "delivered" };
      if (status === "delivered") query.prasadamDeliveryStatus = "delivered";

      if (startDate || endDate) {
        query.createdAt = {};
        if (startDate) query.createdAt.$gte = new Date(startDate);
        if (endDate) { const end = new Date(endDate); end.setHours(23,59,59,999); query.createdAt.$lte = end; }
      }

      if (search) {
        query.$or = [
          { name: { $regex: search, $options: "i" } },
          { mobile: { $regex: search, $options: "i" } },
          { prasadamName: { $regex: search, $options: "i" } },
          { prasadamMobile: { $regex: search, $options: "i" } },
        ];
      }

      const skip = (parseInt(page) - 1) * parseInt(limit);

      const [items, total, pendingCount, deliveredCount] = await Promise.all([
        donationModle.find(query).sort({ createdAt: -1 }).skip(skip).limit(parseInt(limit)),
        donationModle.countDocuments(query),
        donationModle.countDocuments({ mahaprasadam: true, status: { $in: ["paid", "active", "completed"] }, prasadamDeliveryStatus: { $ne: "delivered" } }),
        donationModle.countDocuments({ mahaprasadam: true, status: { $in: ["paid", "active", "completed"] }, prasadamDeliveryStatus: "delivered" }),
      ]);

      const data = items.map(d => {
        // Resolve delivery address
        const useDonorAddress = d.certificate && d.prasadamAddressOption !== "different";
        return {
          id: d._id,
          donorName: d.name,
          donorMobile: d.mobile,
          amount: d.amount,
          date: d.createdAt,
          isRecurring: d.isRecurring,
          recipientName: useDonorAddress ? d.name : (d.prasadamName || d.name),
          recipientMobile: useDonorAddress ? d.mobile : (d.prasadamMobile || d.mobile),
          address: useDonorAddress ? d.address : d.prasadamAddress,
          city: useDonorAddress ? d.city : (d.prasadamCity || d.city),
          state: useDonorAddress ? d.state : (d.prasadamState || d.state),
          pincode: useDonorAddress ? d.pincode : (d.prasadamPincode || d.pincode),
          deliveryStatus: d.prasadamDeliveryStatus || "pending",
          deliveredAt: d.prasadamDeliveredAt,
          whatsappSentAt: d.prasadamWhatsappSentAt,
          trackingNumber: d.prasadamTrackingNumber,
        };
      });

      res.json({
        success: true,
        data,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(total / parseInt(limit)),
          total,
        },
        stats: { pending: pendingCount, delivered: deliveredCount },
      });
    } catch (error) {
      console.error("Prasadam list error:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  },

  // Mark one or more as delivered + send WhatsApp
  markDelivered: async (req, res) => {
    try {
      const { donationIds, sendWhatsapp = true, trackingNumbers = {} } = req.body;
      if (!donationIds || !Array.isArray(donationIds) || donationIds.length === 0) {
        return res.status(400).json({ success: false, message: "donationIds array required" });
      }

      const results = [];

      for (const id of donationIds) {
        try {
          const donation = await donationModle.findById(id);
          if (!donation) {
            results.push({ id, success: false, message: "Not found" });
            continue;
          }

          donation.prasadamDeliveryStatus = "delivered";
          donation.prasadamDeliveredAt = new Date();
          if (trackingNumbers[id]) donation.prasadamTrackingNumber = trackingNumbers[id];

          // Send WhatsApp
          if (sendWhatsapp) {
            try {
              const useDonorAddress = donation.certificate && donation.prasadamAddressOption !== "different";
              const recipientMobile = useDonorAddress ? donation.mobile : (donation.prasadamMobile || donation.mobile);
              const recipientName = useDonorAddress ? donation.name : (donation.prasadamName || donation.name);

              let phone = recipientMobile.replace(/\D/g, "");
              if (!phone.startsWith("91")) phone = `91${phone}`;

              await sendPrasadamDispatchWhatsapp(phone, recipientName, trackingNumbers[id] || donation.prasadamTrackingNumber || "");
              donation.prasadamWhatsappSentAt = new Date();
            } catch (waErr) {
              console.error(`Prasadam WhatsApp failed for ${id}:`, waErr.message);
            }
          }

          await donation.save();
          results.push({ id, success: true, donorName: donation.name });
        } catch (err) {
          results.push({ id, success: false, message: err.message });
        }
      }

      const succeeded = results.filter(r => r.success).length;
      res.json({ success: true, message: `${succeeded}/${donationIds.length} marked as delivered`, results });
    } catch (error) {
      console.error("Mark delivered error:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  },

  // Export pending deliveries as CSV
  exportPrasadamCSV: async (req, res) => {
    try {
      const { status = "pending" } = req.query;
      const query = {
        mahaprasadam: true,
        status: { $in: ["paid", "active", "completed"] },
      };
      if (status === "pending") query.prasadamDeliveryStatus = { $ne: "delivered" };
      if (status === "delivered") query.prasadamDeliveryStatus = "delivered";

      const items = await donationModle.find(query).sort({ createdAt: -1 });

      const headers = ["Donor Name", "Donor Mobile", "Amount", "Donation Date", "Recipient Name", "Recipient Mobile", "Address", "City", "State", "Pincode", "Type", "Status"];
      const rows = items.map(d => {
        const useDonorAddress = d.certificate && d.prasadamAddressOption !== "different";
        return [
          d.name,
          d.mobile,
          d.amount,
          d.createdAt.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" }),
          useDonorAddress ? d.name : (d.prasadamName || d.name),
          useDonorAddress ? d.mobile : (d.prasadamMobile || d.mobile),
          useDonorAddress ? (d.address || "") : (d.prasadamAddress || ""),
          useDonorAddress ? (d.city || "") : (d.prasadamCity || d.city || ""),
          useDonorAddress ? (d.state || "") : (d.prasadamState || d.state || ""),
          useDonorAddress ? (d.pincode || "") : (d.prasadamPincode || d.pincode || ""),
          d.isRecurring ? "Monthly" : "One-time",
          d.prasadamDeliveryStatus === "delivered" ? "Delivered" : "Pending",
        ];
      });

      const csv = [
        headers.join(","),
        ...rows.map(row => row.map(val => {
          if (typeof val === "string" && (val.includes(",") || val.includes('"') || val.includes("\n"))) {
            return '"' + val.replace(/"/g, '""') + '"';
          }
          return val;
        }).join(",")),
      ].join("\n");

      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename="prasadam_${status}_deliveries.csv"`);
      res.send(csv);
    } catch (error) {
      console.error("Prasadam CSV export error:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  },

};

module.exports = { prasadamController };
