
const mongoose = require("mongoose");
const { Admin } = require("../models/admin.model");
require("dotenv").config();

const createAdmin = async () => {
  try {
    const mongoUrl = process.env.MONGOURL || process.env.MONGODB_URI;
    
    if (!mongoUrl) {
      console.error("❌ MongoDB URL not found in .env file!");
      console.error("Please add MONGOURL or MONGODB_URI to your .env file");
      process.exit(1);
    }

    await mongoose.connect(mongoUrl);
    console.log("Connected to database");

    const existingAdmin = await Admin.findOne({ username: "admin" });
    
    if (existingAdmin) {
      console.log("❌ Admin user already exists!");
      console.log("Username:", existingAdmin.username);
      console.log("Email:", existingAdmin.email);
      process.exit(0);
    }

    const admin = new Admin({
      username: "admin",
      email: "admin@subhojanam.org",
      password: "admin123", // This will be hashed automatically
      name: "Admin User",
      role: "super-admin",
      isActive: true
    });

    await admin.save();

    console.log("✅ Admin user created successfully!");
    console.log("==================================");
    console.log("Username: admin");
    console.log("Email: admin@subhojanam.org");
    console.log("Password: admin123");
    console.log("==================================");
    console.log("⚠️  Please change the password after first login!");
    
    process.exit(0);
  } catch (error) {
    console.error("Error creating admin:", error);
    process.exit(1);
  }
};

createAdmin();
