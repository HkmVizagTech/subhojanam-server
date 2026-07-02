
const express = require("express");
const { adminController } = require("../controllers/admin.controller");
const { adminAuth } = require("../middlewares/admin.auth.middleware");
const { adminSubscriptionController } = require("../controllers/admin.subscription.controller");
const campaignController = require("../controllers/campaign.controller.js");
const { missedChargesController } = require("../controllers/missed.charges.controller");
const { offlineDonationController } = require("../controllers/offline.donation.controller");
const { prasadamController } = require("../controllers/prasadam.controller");
const { subscriptionRepairController } = require("../controllers/subscription.repair.controller");
const adminRouter = express.Router();


adminRouter.get("/utm-stats", adminController.getUtmStats);
adminRouter.get("/utm-transactions", adminController.getUtmTransactions);



adminRouter.post("/create-campaign", campaignController.createCampaign);
adminRouter.get("/campaigns", campaignController.listCampaigns);
adminRouter.delete("/campaigns/:id", campaignController.deleteCampaign);

adminRouter.use(adminAuth);

adminRouter.get("/dashboard/stats", adminController.getDashboardStats);
adminRouter.get("/dashboard/recent-transactions", adminController.getRecentTransactions);
adminRouter.get("/dashboard/top-donors", adminController.getTopDonors);
adminRouter.get("/dashboard/monthly-trends", adminController.getMonthlyTrends);

adminRouter.get("/transactions", adminController.getAllTransactions);
adminRouter.get("/transactions/receipt-debug", adminController.receiptDebug);
adminRouter.post("/transactions/register-subscription-charge", adminController.registerSubscriptionCharge);
adminRouter.post("/transactions/offline", offlineDonationController.createOfflineDonation);

adminRouter.get("/prasadam", prasadamController.getPrasadamList);
adminRouter.post("/prasadam/mark-delivered", prasadamController.markDelivered);
adminRouter.get("/prasadam/export", prasadamController.exportPrasadamCSV);

adminRouter.get("/subscription-repair/diagnose", subscriptionRepairController.diagnoseMismatch);
adminRouter.post("/subscription-repair/fix", subscriptionRepairController.fixSubscription);
adminRouter.post("/subscription-repair/sync-charge", subscriptionRepairController.syncMissingCharge);
adminRouter.get("/subscription-repair/verify", subscriptionRepairController.verifyPayment);
adminRouter.post("/subscription-repair/fix-payment-donor", subscriptionRepairController.fixPaymentDonor);
adminRouter.get("/subscription-repair/bulk-diagnose", subscriptionRepairController.bulkDiagnoseMisattributed);
adminRouter.post("/subscription-repair/bulk-fix", subscriptionRepairController.bulkFixMisattributed);
adminRouter.patch("/transactions/:id/mark-receipt-generated", adminController.markReceiptGenerated);
adminRouter.get("/transactions/stats", adminController.getTransactionStats);
adminRouter.get("/transactions/export", adminController.exportTransactions);
adminRouter.get("/transactions/all-unreceipted", missedChargesController.getAllUnreceiptedCharges);
adminRouter.get("/receipts/health-check", adminController.getReceiptsHealthCheck);
adminRouter.get("/transactions/:id", adminController.getTransactionById);
adminRouter.post("/transactions/:id/resend-receipt", adminController.resendReceipt);

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

adminRouter.get("/subscriptions/missed-charges", missedChargesController.getMissedCharges);
adminRouter.post("/subscriptions/register-missed-charge", missedChargesController.registerMissedCharge);
adminRouter.get("/subscriptions/unreceipted-charges", missedChargesController.getUnreceiptedCharges);
adminRouter.post("/subscriptions/generate-missing-receipt", missedChargesController.generateMissingReceipt);

module.exports = { adminRouter };
