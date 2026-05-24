const express = require("express");
const authController = require("../controllers/auth.controller");
const { adminAuth } = require("../middlewares/admin.auth.middleware");

const router = express.Router();

// Middleware to protect admin registration with internal secret
const internalSecretGuard = (req, res, next) => {
  const provided = req.headers["x-internal-secret"];
  if (!process.env.INTERNAL_SECRET || provided !== process.env.INTERNAL_SECRET) {
    return res.status(404).json({ success: false, message: "Not found" });
  }
  next();
};

router.post("/login", authController.login);
router.post("/logout", authController.logout);
router.post("/x7k9m2p5q8w3", internalSecretGuard, authController.register);

router.get("/verify", adminAuth, authController.verifyToken);
router.post("/change-password", adminAuth, authController.changePassword);

module.exports = router;
