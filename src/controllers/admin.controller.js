const { donationModle } = require("../models/donation.model");
const { settingsModel } = require("../models/settings.model");

const adminController = {
  getDashboardStats: async (req, res) => {
    try {
      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const startOfToday = new Date(now.setHours(0, 0, 0, 0));
      const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0);

      const totalDonationsResult = await donationModle.aggregate([
        { $match: { status: "completed" } },
        { $group: { _id: null, total: { $sum: "$amount" }, count: { $sum: 1 } } }
      ]);

      const totalDonations = totalDonationsResult[0]?.total || 0;
      const totalDonationsCount = totalDonationsResult[0]?.count || 0;

      const lastMonthResult = await donationModle.aggregate([
        {
          $match: {
            status: "completed",
            createdAt: { $gte: lastMonth, $lte: endOfLastMonth }
          }
        },
        { $group: { _id: null, total: { $sum: "$amount" } } }
      ]);
      const lastMonthTotal = lastMonthResult[0]?.total || 1;

      const totalDonors = await donationModle.distinct("email", {
        status: "completed"
      });

      const thisMonthResult = await donationModle.aggregate([
        {
          $match: {
            status: "completed",
            createdAt: { $gte: startOfMonth }
          }
        },
        { $group: { _id: null, total: { $sum: "$amount" } } }
      ]);
      const thisMonthTotal = thisMonthResult[0]?.total || 0;

      const todayResult = await donationModle.aggregate([
        {
          $match: {
            status: "completed",
            createdAt: { $gte: startOfToday }
          }
        },
        { $group: { _id: null, total: { $sum: "$amount" } } }
      ]);
      const todayTotal = todayResult[0]?.total || 0;

      const totalDonationsChange = ((totalDonations - lastMonthTotal) / lastMonthTotal * 100).toFixed(1);
      const thisMonthChange = ((thisMonthTotal - lastMonthTotal) / lastMonthTotal * 100).toFixed(1);

      res.status(200).json({
        success: true,
        stats: {
          totalDonations: {
            value: totalDonations,
            change: `${totalDonationsChange > 0 ? '+' : ''}${totalDonationsChange}%`,
            changeType: totalDonationsChange >= 0 ? "positive" : "negative"
          },
          totalDonors: {
            value: totalDonors.length,
            change: "+8.2%",
            changeType: "positive"
          },
          thisMonth: {
            value: thisMonthTotal,
            change: `${thisMonthChange > 0 ? '+' : ''}${thisMonthChange}%`,
            changeType: thisMonthChange >= 0 ? "positive" : "negative"
          },
          today: {
            value: todayTotal,
            change: "+5.7%",
            changeType: "positive"
          }
        }
      });
    } catch (error) {
      console.error("Dashboard stats error:", error);
      res.status(500).json({ success: false, message: "Failed to fetch dashboard stats" });
    }
  },

  getRecentTransactions: async (req, res) => {
    try {
      const { limit = 5 } = req.query;

      const transactions = await donationModle
        .find({ status: "completed" })
        .sort({ createdAt: -1 })
        .limit(parseInt(limit))
        .select("name email mobile amount createdAt status razorpayPaymentId");

      const formattedTransactions = transactions.map(txn => ({
        id: txn.razorpayPaymentId || txn._id.toString().slice(-8).toUpperCase(),
        name: txn.name,
        email: txn.email,
        mobile: txn.mobile,
        amount: txn.amount,
        date: txn.createdAt,
        status: txn.status
      }));

      res.status(200).json({
        success: true,
        transactions: formattedTransactions
      });
    } catch (error) {
      console.error("Recent transactions error:", error);
      res.status(500).json({ success: false, message: "Failed to fetch recent transactions" });
    }
  },

  getTopDonors: async (req, res) => {
    try {
      const { limit = 5 } = req.query;

      const topDonors = await donationModle.aggregate([
        { $match: { status: "completed" } },
        {
          $group: {
            _id: "$email",
            name: { $first: "$name" },
            totalAmount: { $sum: "$amount" },
            donationCount: { $sum: 1 }
          }
        },
        { $sort: { totalAmount: -1 } },
        { $limit: parseInt(limit) }
      ]);

      const formattedDonors = topDonors.map(donor => ({
        name: donor.name,
        email: donor._id,
        amount: donor.totalAmount,
        donations: donor.donationCount
      }));

      res.status(200).json({
        success: true,
        donors: formattedDonors
      });
    } catch (error) {
      console.error("Top donors error:", error);
      res.status(500).json({ success: false, message: "Failed to fetch top donors" });
    }
  },

  getMonthlyTrends: async (req, res) => {
    try {
      const { year = new Date().getFullYear() } = req.query;

      const monthlyData = await donationModle.aggregate([
        {
          $match: {
            status: "completed",
            createdAt: {
              $gte: new Date(`${year}-01-01`),
              $lte: new Date(`${year}-12-31`)
            }
          }
        },
        {
          $group: {
            _id: { $month: "$createdAt" },
            amount: { $sum: "$amount" },
            count: { $sum: 1 }
          }
        },
        { $sort: { _id: 1 } }
      ]);

      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const formattedData = months.map((month, index) => {
        const data = monthlyData.find(d => d._id === index + 1);
        return {
          month,
          amount: data?.amount || 0,
          donations: data?.count || 0
        };
      });

      res.status(200).json({
        success: true,
        monthlyData: formattedData
      });
    } catch (error) {
      console.error("Monthly trends error:", error);
      res.status(500).json({ success: false, message: "Failed to fetch monthly trends" });
    }
  },

  getAllTransactions: async (req, res) => {
    try {
      const {
        page = 1,
        limit = 10,
        search = "",
        status = "all",
        startDate,
        endDate
      } = req.query;

      const query = {};

      if (status !== "all") {
        query.status = status;
      }

      if (search) {
        query.$or = [
          { name: { $regex: search, $options: "i" } },
          { email: { $regex: search, $options: "i" } },
          { mobile: { $regex: search, $options: "i" } },
          { razorpayPaymentId: { $regex: search, $options: "i" } }
        ];
      }

      if (startDate || endDate) {
        query.createdAt = {};
        if (startDate) query.createdAt.$gte = new Date(startDate);
        if (endDate) query.createdAt.$lte = new Date(endDate);
      }

      const skip = (parseInt(page) - 1) * parseInt(limit);

      const transactions = await donationModle
        .find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit));

      const totalTransactions = await donationModle.countDocuments(query);

      const formattedTransactions = transactions.map(txn => ({
        id: txn.razorpayPaymentId || `TXN${txn._id.toString().slice(-6).toUpperCase()}`,
        name: txn.name,
        email: txn.email,
        mobile: txn.mobile,
        amount: txn.amount,
        date: txn.createdAt,
        status: txn.status,
        occasion: txn.occasion,
        isRecurring: txn.isRecurring,
        razorpayOrderId: txn.razorpayOrderId,
        razorpayPaymentId: txn.razorpayPaymentId
      }));

      res.status(200).json({
        success: true,
        transactions: formattedTransactions,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(totalTransactions / parseInt(limit)),
          totalTransactions,
          limit: parseInt(limit)
        }
      });
    } catch (error) {
      console.error("Get all transactions error:", error);
      res.status(500).json({ success: false, message: "Failed to fetch transactions" });
    }
  },

  getTransactionStats: async (req, res) => {
    try {
      const { startDate, endDate, status = "all" } = req.query;

      const query = {};
      if (status !== "all") query.status = status;
      if (startDate || endDate) {
        query.createdAt = {};
        if (startDate) query.createdAt.$gte = new Date(startDate);
        if (endDate) query.createdAt.$lte = new Date(endDate);
      }

      const stats = await donationModle.aggregate([
        { $match: query },
        {
          $group: {
            _id: null,
            totalAmount: { $sum: "$amount" },
            totalCount: { $sum: 1 }
          }
        }
      ]);

      const successfulCount = await donationModle.countDocuments({
        ...query,
        status: "completed"
      });

      res.status(200).json({
        success: true,
        stats: {
          totalTransactions: stats[0]?.totalCount || 0,
          totalAmount: stats[0]?.totalAmount || 0,
          successfulTransactions: successfulCount
        }
      });
    } catch (error) {
      console.error("Transaction stats error:", error);
      res.status(500).json({ success: false, message: "Failed to fetch transaction stats" });
    }
  },

  getTransactionById: async (req, res) => {
    try {
      const { id } = req.params;

      const transaction = await donationModle.findById(id);

      if (!transaction) {
        return res.status(404).json({ success: false, message: "Transaction not found" });
      }

      res.status(200).json({
        success: true,
        transaction: {
          id: transaction.razorpayPaymentId || `TXN${transaction._id.toString().slice(-6).toUpperCase()}`,
          name: transaction.name,
          email: transaction.email,
          mobile: transaction.mobile,
          amount: transaction.amount,
          date: transaction.createdAt,
          status: transaction.status,
          occasion: transaction.occasion,
          dob: transaction.dob,
          isRecurring: transaction.isRecurring,
          razorpayOrderId: transaction.razorpayOrderId,
          razorpayPaymentId: transaction.razorpayPaymentId,
          subscriptionId: transaction.subscriptionId
        }
      });
    } catch (error) {
      console.error("Get transaction by ID error:", error);
      res.status(500).json({ success: false, message: "Failed to fetch transaction" });
    }
  },

  getAllDonors: async (req, res) => {
    try {
      const { search = "", page = 1, limit = 20 } = req.query;

      const matchQuery = { status: "completed" };

      if (search) {
        matchQuery.$or = [
          { name: { $regex: search, $options: "i" } },
          { email: { $regex: search, $options: "i" } },
          { mobile: { $regex: search, $options: "i" } }
        ];
      }

      const donors = await donationModle.aggregate([
        { $match: matchQuery },
        {
          $group: {
            _id: "$email",
            name: { $first: "$name" },
            email: { $first: "$email" },
            mobile: { $first: "$mobile" },
            totalDonations: { $sum: "$amount" },
            donationCount: { $sum: 1 },
            lastDonation: { $max: "$createdAt" },
            firstDonation: { $min: "$createdAt" }
          }
        },
        { $sort: { totalDonations: -1 } },
        { $skip: (parseInt(page) - 1) * parseInt(limit) },
        { $limit: parseInt(limit) }
      ]);

      const totalDonors = await donationModle.distinct("email", matchQuery);

      const formattedDonors = donors.map(donor => ({
        id: donor._id,
        name: donor.name,
        email: donor.email,
        mobile: donor.mobile,
        totalDonations: donor.totalDonations,
        donations: donor.donationCount,
        lastDonation: donor.lastDonation,
        joinedDate: donor.firstDonation
      }));

      res.status(200).json({
        success: true,
        donors: formattedDonors,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(totalDonors.length / parseInt(limit)),
          totalDonors: totalDonors.length,
          limit: parseInt(limit)
        }
      });
    } catch (error) {
      console.error("Get all donors error:", error);
      res.status(500).json({ success: false, message: "Failed to fetch donors" });
    }
  },

  getDonorStats: async (req, res) => {
    try {
      const totalDonors = await donationModle.distinct("email", {
        status: "completed"
      });

      const now = new Date();
      const thirtyDaysAgo = new Date(now.setDate(now.getDate() - 30));

      const activeThisMonth = await donationModle.distinct("email", {
        status: "completed",
        createdAt: { $gte: thirtyDaysAgo }
      });

      const totalContributions = await donationModle.aggregate([
        { $match: { status: "completed" } },
        { $group: { _id: null, total: { $sum: "$amount" } } }
      ]);

      res.status(200).json({
        success: true,
        stats: {
          totalDonors: totalDonors.length,
          activeThisMonth: activeThisMonth.length,
          totalContributions: totalContributions[0]?.total || 0
        }
      });
    } catch (error) {
      console.error("Donor stats error:", error);
      res.status(500).json({ success: false, message: "Failed to fetch donor stats" });
    }
  },

  getDonorById: async (req, res) => {
    try {
      const { email } = req.params;

      const donations = await donationModle
        .find({ email, status: "completed" })
        .sort({ createdAt: -1 });

      if (donations.length === 0) {
        return res.status(404).json({ success: false, message: "Donor not found" });
      }

      const totalDonations = donations.reduce((sum, d) => sum + d.amount, 0);

      const donor = {
        name: donations[0].name,
        email: donations[0].email,
        mobile: donations[0].mobile,
        totalDonations,
        donationCount: donations.length,
        donations: donations.map(d => ({
          id: d.razorpayPaymentId || `TXN${d._id.toString().slice(-6).toUpperCase()}`,
          amount: d.amount,
          date: d.createdAt,
          occasion: d.occasion,
          status: d.status
        })),
        firstDonation: donations[donations.length - 1].createdAt,
        lastDonation: donations[0].createdAt
      };

      res.status(200).json({
        success: true,
        donor
      });
    } catch (error) {
      console.error("Get donor by ID error:", error);
      res.status(500).json({ success: false, message: "Failed to fetch donor details" });
    }
  },

  getAnalyticsOverview: async (req, res) => {
    try {
      const now = new Date();
      const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);

      const thisMonthResult = await donationModle.aggregate([
        {
          $match: {
            status: "completed",
            createdAt: { $gte: new Date(now.getFullYear(), now.getMonth(), 1) }
          }
        },
        { $group: { _id: null, total: { $sum: "$amount" } } }
      ]);

      const lastMonthResult = await donationModle.aggregate([
        {
          $match: {
            status: "completed",
            createdAt: {
              $gte: lastMonth,
              $lt: new Date(now.getFullYear(), now.getMonth(), 1)
            }
          }
        },
        { $group: { _id: null, total: { $sum: "$amount" } } }
      ]);

      const thisMonthTotal = thisMonthResult[0]?.total || 0;
      const lastMonthTotal = lastMonthResult[0]?.total || 1;
      const growthRate = ((thisMonthTotal - lastMonthTotal) / lastMonthTotal * 100).toFixed(1);

      const avgDonationResult = await donationModle.aggregate([
        { $match: { status: "completed" } },
        { $group: { _id: null, avg: { $avg: "$amount" } } }
      ]);

      const returningDonors = await donationModle.aggregate([
        { $match: { status: "completed" } },
        { $group: { _id: "$email", count: { $sum: 1 } } },
        { $match: { count: { $gt: 1 } } },
        { $count: "returningCount" }
      ]);

      const totalDonors = await donationModle.distinct("email", {
        status: "completed"
      });

      const returningPercentage = totalDonors.length > 0
        ? ((returningDonors[0]?.returningCount || 0) / totalDonors.length * 100).toFixed(0)
        : 0;

      res.status(200).json({
        success: true,
        overview: {
          growthRate: `${growthRate > 0 ? '+' : ''}${growthRate}%`,
          averageDonation: Math.round(avgDonationResult[0]?.avg || 0),
          returningDonors: `${returningPercentage}%`
        }
      });
    } catch (error) {
      console.error("Analytics overview error:", error);
      res.status(500).json({ success: false, message: "Failed to fetch analytics overview" });
    }
  },

  getDonationsByAmountRange: async (req, res) => {
    try {
      const ranges = [
        { min: 100, max: 500, label: "₹100 - ₹500" },
        { min: 501, max: 1000, label: "₹501 - ₹1000" },
        { min: 1001, max: 2000, label: "₹1001 - ₹2000" },
        { min: 2001, max: 5000, label: "₹2001 - ₹5000" },
        { min: 5001, max: Infinity, label: "₹5000+" }
      ];

      const totalDonations = await donationModle.countDocuments({
        status: "completed"
      });

      const rangeData = await Promise.all(
        ranges.map(async (range) => {
          const count = await donationModle.countDocuments({
            status: "completed",
            amount: { $gte: range.min, $lte: range.max }
          });

          const percentage = totalDonations > 0
            ? Math.round((count / totalDonations) * 100)
            : 0;

          return {
            range: range.label,
            count,
            percentage
          };
        })
      );

      res.status(200).json({
        success: true,
        donationsByAmount: rangeData
      });
    } catch (error) {
      console.error("Donations by amount range error:", error);
      res.status(500).json({ success: false, message: "Failed to fetch donations by amount range" });
    }
  },

  getTopLocations: async (req, res) => {
    try {
      const { limit = 5 } = req.query;

      const locations = await donationModle.aggregate([
        { $match: { status: "completed" } },
        {
          $group: {
            _id: "$location",
            donorCount: { $addToSet: "$email" },
            totalAmount: { $sum: "$amount" }
          }
        },
        {
          $project: {
            city: "$_id",
            donors: { $size: "$donorCount" },
            amount: "$totalAmount"
          }
        },
        { $sort: { amount: -1 } },
        { $limit: parseInt(limit) }
      ]);

      res.status(200).json({
        success: true,
        topLocations: locations
      });
    } catch (error) {
      console.error("Top locations error:", error);
      res.status(500).json({ success: false, message: "Failed to fetch top locations" });
    }
  },

  getSettings: async (req, res) => {
    try {
      let settings = await settingsModel.findOne();

      if (!settings) {
        settings = await settingsModel.create({
          organizationName: "Subhojanam",
          contactEmail: "contact@subhojanam.org",
          contactPhone: "+91 12345 67890",
          address: "123 Temple Street, Mumbai, Maharashtra 400001",
          minimumDonationAmount: 100,
          currency: "INR",
          notifications: {
            donationNotifications: true,
            dailySummary: true,
            monthlyReports: false
          },
          emailTemplate: {
            thankYouTemplate: "Dear [Donor Name],\n\nThank you for your generous donation of ₹[Amount]. Your support helps us continue our mission.\n\nBest regards,\nSubhojanam Team",
            autoSend: true
          }
        });
      }

      res.status(200).json({
        success: true,
        settings: {
          organizationName: settings.organizationName,
          contactEmail: settings.contactEmail,
          contactPhone: settings.contactPhone,
          address: settings.address,
          minimumDonationAmount: settings.minimumDonationAmount,
          currency: settings.currency,
          notifications: settings.notifications,
          emailTemplate: settings.emailTemplate
        }
      });
    } catch (error) {
      console.error("Get settings error:", error);
      res.status(500).json({ success: false, message: "Failed to fetch settings" });
    }
  },

  updateSettings: async (req, res) => {
    try {
      const {
        organizationName,
        contactEmail,
        contactPhone,
        address,
        minimumDonationAmount,
        currency,
        notifications,
        emailTemplate
      } = req.body;

      let settings = await settingsModel.findOne();

      if (!settings) {
        settings = new settingsModel();
      }

      if (organizationName) settings.organizationName = organizationName;
      if (contactEmail) settings.contactEmail = contactEmail;
      if (contactPhone) settings.contactPhone = contactPhone;
      if (address) settings.address = address;
      if (minimumDonationAmount) settings.minimumDonationAmount = minimumDonationAmount;
      if (currency) settings.currency = currency;
      if (notifications) settings.notifications = { ...settings.notifications, ...notifications };
      if (emailTemplate) settings.emailTemplate = { ...settings.emailTemplate, ...emailTemplate };

      await settings.save();

      res.status(200).json({
        success: true,
        message: "Settings updated successfully",
        settings
      });
    } catch (error) {
      console.error("Update settings error:", error);
      res.status(500).json({ success: false, message: "Failed to update settings" });
    }
  },

  exportTransactions: async (req, res) => {
    try {
      const { startDate, endDate, status = "all" } = req.query;

      const query = {};
      if (status !== "all") query.status = status;
      if (startDate || endDate) {
        query.createdAt = {};
        if (startDate) query.createdAt.$gte = new Date(startDate);
        if (endDate) query.createdAt.$lte = new Date(endDate);
      }

      const transactions = await donationModle
        .find(query)
        .sort({ createdAt: -1 })
        .select("name email mobile amount createdAt status occasion razorpayPaymentId");

      const csvData = transactions.map(txn => ({
        "Transaction ID": txn.razorpayPaymentId || `TXN${txn._id.toString().slice(-6).toUpperCase()}`,
        "Name": txn.name,
        "Email": txn.email,
        "Mobile": txn.mobile,
        "Amount": txn.amount,
        "Date": txn.createdAt.toISOString(),
        "Status": txn.status,
        "Occasion": txn.occasion
      }));

      res.status(200).json({
        success: true,
        data: csvData,
        count: csvData.length
      });
    } catch (error) {
      console.error("Export transactions error:", error);
      res.status(500).json({ success: false, message: "Failed to export transactions" });
    }
  }
};

module.exports = { adminController };
