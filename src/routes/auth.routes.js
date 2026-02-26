const express = require("express");
const authController = require("../controllers/auth.controller");
const { adminAuth } = require("../middlewares/admin.auth.middleware");

const router = express.Router();

router.post("/login", authController.login);
router.post("/logout", authController.logout);
router.post("/x7k9m2p5q8w3", authController.register);

router.get("/verify", adminAuth, authController.verifyToken);
router.post("/change-password", adminAuth, authController.changePassword);

module.exports = router;
