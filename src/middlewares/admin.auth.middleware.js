const jwt = require("jsonwebtoken");
const { Admin } = require("../models/admin.model");

const JWT_SECRET = process.env.JWT_SECRET || "your-super-secret-jwt-key-change-in-production";

const adminAuth = async (req, res, next) => {
  try {
    const token = req.cookies.adminToken || req.headers.authorization?.replace('Bearer ', '');

    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Authentication required. Please login."
      });
    }

    const decoded = jwt.verify(token, JWT_SECRET);

    const admin = await Admin.findById(decoded.id).select('-password');
    
    if (!admin) {
      return res.status(401).json({
        success: false,
        message: "Invalid token. Admin not found."
      });
    }

    if (!admin.isActive) {
      return res.status(403).json({
        success: false,
        message: "Account is deactivated."
      });
    }

    req.admin = {
      id: admin._id,
      username: admin.username,
      email: admin.email,
      role: admin.role
    };

    next();
  } catch (error) {
    console.error("Admin auth error:", error);
    
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        message: "Invalid token"
      });
    }
    
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: "Token expired. Please login again."
      });
    }

    res.status(500).json({
      success: false,
      message: "Authentication error"
    });
  }
};

module.exports = { adminAuth };
