const express = require("express");
const { adminController } = require("../controllers/admin.controller");
const { adminAuth } = require("../middlewares/admin.auth.middleware");
const { adminSubscriptionController } = require("../controllers/admin.subscription.controller");
const adminRouter = express.Router();

adminRouter.use(adminAuth);

adminRouter.get("/dashboard/stats", adminController.getDashboardStats);
adminRouter.get("/dashboard/recent-transactions", adminController.getRecentTransactions);
adminRouter.get("/dashboard/top-donors", adminController.getTopDonors);
adminRouter.get("/dashboard/monthly-trends", adminController.getMonthlyTrends);

adminRouter.get("/transactions", adminController.getAllTransactions);
adminRouter.get("/transactions/stats", adminController.getTransactionStats);
adminRouter.get("/transactions/:id", adminController.getTransactionById);
adminRouter.get("/transactions/export", adminController.exportTransactions);

adminRouter.get("/donors", adminController.getAllDonors);
adminRouter.get("/donors/stats", adminController.getDonorStats);
adminRouter.get("/donors/:email", adminController.getDonorById);

adminRouter.get("/analytics/overview", adminController.getAnalyticsOverview);
adminRouter.get("/analytics/amount-range", adminController.getDonationsByAmountRange);
adminRouter.get("/analytics/top-locations", adminController.getTopLocations);

adminRouter.get("/settings", adminController.getSettings);
adminRouter.put("/settings", adminController.updateSettings);


adminRouter.get("/subscriptions", adminSubscriptionController.getAllSubscriptions);
adminRouter.get("/subscriptions/review", adminSubscriptionController.getSubscriptionsForReview);
adminRouter.get("/subscriptions/stats", adminSubscriptionController.getSubscriptionStats);
adminRouter.put("/subscriptions/:id/cancel", adminSubscriptionController.cancelSubscription);

module.exports = { adminRouter };
