const { Admin } = require("../models/admin.model");
const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET || "your-super-secret-jwt-key-change-in-production";
const JWT_EXPIRES_IN = "7d";

const authController = {
  register: async (req, res) => {
    try {
      const { username, email, password, name } = req.body;

      if (!username || !email || !password || !name) {
        return res.status(400).json({
          success: false,
          message: "All fields are required"
        });
      }

      if (password.length < 6) {
        return res.status(400).json({
          success: false,
          message: "Password must be at least 6 characters"
        });
      }

      const existingAdmin = await Admin.findOne({
        $or: [{ username }, { email }]
      });

      if (existingAdmin) {
        return res.status(400).json({
          success: false,
          message: "Username or email already exists"
        });
      }

      const admin = new Admin({
        username,
        email,
        password,
        name,
        role: 'admin',
        isActive: true
      });

      await admin.save();

      const token = jwt.sign(
        { 
          id: admin._id, 
          username: admin.username,
          email: admin.email,
          role: admin.role
        },
        JWT_SECRET,
        { expiresIn: JWT_EXPIRES_IN }
      );

      res.cookie('adminToken', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 7 * 24 * 60 * 60 * 1000
      });

      res.status(201).json({
        success: true,
        message: "Registration successful",
        admin: {
          id: admin._id,
          username: admin.username,
          email: admin.email,
          name: admin.name,
          role: admin.role
        },
        token
      });

    } catch (error) {
      console.error("Registration error:", error);
      res.status(500).json({
        success: false,
        message: "Server error during registration"
      });
    }
  },

  login: async (req, res) => {
    try {
      const { username, password } = req.body;

      if (!username || !password) {
        return res.status(400).json({
          success: false,
          message: "Username and password are required"
        });
      }

      const admin = await Admin.findOne({
        $or: [{ username }, { email: username }]
      });

      if (!admin) {
        return res.status(401).json({
          success: false,
          message: "Invalid credentials"
        });
      }

      if (!admin.isActive) {
        return res.status(403).json({
          success: false,
          message: "Account is deactivated"
        });
      }

      const isPasswordValid = await admin.comparePassword(password);
      
      if (!isPasswordValid) {
        return res.status(401).json({
          success: false,
          message: "Invalid credentials"
        });
      }

      admin.lastLogin = new Date();
      await admin.save();

      const token = jwt.sign(
        { 
          id: admin._id, 
          username: admin.username,
          email: admin.email,
          role: admin.role
        },
        JWT_SECRET,
        { expiresIn: JWT_EXPIRES_IN }
      );

      res.cookie('adminToken', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 7 * 24 * 60 * 60 * 1000
      });

      res.status(200).json({
        success: true,
        message: "Login successful",
        admin: {
          id: admin._id,
          username: admin.username,
          email: admin.email,
          name: admin.name,
          role: admin.role,
          lastLogin: admin.lastLogin
        },
        token
      });

    } catch (error) {
      console.error("Login error:", error);
      res.status(500).json({
        success: false,
        message: "Server error during login"
      });
    }
  },

  logout: async (req, res) => {
    try {
      res.clearCookie('adminToken');
      res.status(200).json({
        success: true,
        message: "Logged out successfully"
      });
    } catch (error) {
      console.error("Logout error:", error);
      res.status(500).json({
        success: false,
        message: "Server error during logout"
      });
    }
  },

  verifyToken: async (req, res) => {
    try {
      const admin = await Admin.findById(req.admin.id).select('-password');
      
      if (!admin) {
        return res.status(404).json({
          success: false,
          message: "Admin not found"
        });
      }

      res.status(200).json({
        success: true,
        admin: {
          id: admin._id,
          username: admin.username,
          email: admin.email,
          name: admin.name,
          role: admin.role,
          lastLogin: admin.lastLogin
        }
      });
    } catch (error) {
      console.error("Verify token error:", error);
      res.status(500).json({
        success: false,
        message: "Server error"
      });
    }
  },

  changePassword: async (req, res) => {
    try {
      const { currentPassword, newPassword } = req.body;

      if (!currentPassword || !newPassword) {
        return res.status(400).json({
          success: false,
          message: "Current password and new password are required"
        });
      }

      if (newPassword.length < 6) {
        return res.status(400).json({
          success: false,
          message: "New password must be at least 6 characters long"
        });
      }

      const admin = await Admin.findById(req.admin.id);

      if (!admin) {
        return res.status(404).json({
          success: false,
          message: "Admin not found"
        });
      }

      const isPasswordValid = await admin.comparePassword(currentPassword);
      
      if (!isPasswordValid) {
        return res.status(401).json({
          success: false,
          message: "Current password is incorrect"
        });
      }

      admin.password = newPassword;
      admin.updatedAt = new Date();
      await admin.save();

      res.status(200).json({
        success: true,
        message: "Password changed successfully"
      });

    } catch (error) {
      console.error("Change password error:", error);
      res.status(500).json({
        success: false,
        message: "Server error while changing password"
      });
    }
  }
};

module.exports = authController;
