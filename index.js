// const express = require("express");
// require("dotenv").config();
// const { connectDb } = require("./src/config/db");
// const cookieParser = require("cookie-parser");
// const { paymentRouter } = require("./src/routes/payment.routes");
// const { adminRouter } = require("./src/routes/admin.routes");
// const authRouter = require("./src/routes/auth.routes");
// const cors = require("cors");
// const { donationModle } = require("./src/models/donation.model");
// const { sendPendingWhatsapp } = require("./src/services/whatsapp.service");

// // const debugRouter = require("./src/routes/debug.routes");

// const app = express();

// app.use(
//   cors({
//     origin: ["https://annadan.harekrishnavizag.org"],
//     origin: ["http://localhost:5173"],
//     methods: ["GET", "POST", "PUT", "DELETE"],
//     credentials: true,
//   }),
// );

// app.post(
//   "/api/webhook/razorpay",
//   express.raw({ type: "application/json" }),
//   require("./src/controllers/webhook.controller").webHookControler.webhook,
// );

// app.use(express.json());
// app.use(cookieParser());

// app.use("/api/payment", paymentRouter);
// app.use("/api/auth", authRouter);
// app.use("/api/admin", adminRouter);
// app.use("/public", express.static("public"));

// // app.use("/api/admin", debugRouter);
// // app.use("/api/admin", require("./src/routes/debug-utm-count.routes"));

// app.get("/api/internal/send-pending-reminders", async (req, res) => {
//   if (req.headers["x-internal-secret"] !== process.env.INTERNAL_SECRET) {
//     return res.status(401).json({ error: "Unauthorized" });
//   }

//   try {
//     const cutoff = new Date(Date.now() - 6 * 60 * 1000);
//     const pendingDonations = await donationModle.find({
//       status: "created",
//       createdAt: { $lte: cutoff },
//       whatsappPendingReminderSent: { $ne: true },
//     });

//     console.log(
//       `Reminder check: found ${pendingDonations.length} pending donations`,
//     );

//     for (const donation of pendingDonations) {
//       try {
//         const raw = donation.mobile.replace(/^\+/, "");
//         const phone = raw.startsWith("91") ? raw : `91${raw}`;
//         await sendPendingWhatsapp(phone, donation.name, donation.amount);
//         donation.whatsappPendingReminderSent = true;
//         await donation.save();
//         console.log(`Reminder sent to ${phone} for donation ${donation._id}`);
//       } catch (err) {
//         console.error(
//           "Failed for donation",
//           donation._id,
//           err.response?.data || err.message,
//         );
//       }
//     }

//     res.json({ success: true, processed: pendingDonations.length });
//   } catch (err) {
//     console.error("Reminder job error:", err);
//     res.status(500).json({ error: err.message });
//   }
// });

// const server = async () => {
//   try {
//     await connectDb();
//     const PORT = process.env.PORT || 8080;
//     app.listen(PORT, () => {
//       console.log(`server connected on port ${PORT}`);
//     });
//   } catch (error) {
//     console.log("server disconnected", error);
//   }
// };

// server();

const express = require("express");
const path = require("path");
const fs = require("fs");

// ============================================
// ENVIRONMENT CONFIGURATION - LOAD CORRECT .env
// ============================================
const envFile = process.env.NODE_ENV === "development" ? ".env.local" : ".env";
const envPath = path.join(__dirname, envFile);

if (fs.existsSync(envPath)) {
  require("dotenv").config({ path: envPath });
  console.log(`✅ Loaded environment: ${envFile}`);
} else {
  require("dotenv").config();
  console.log(`⚠️ ${envFile} not found, using default .env`);
}

// Validate critical environment variables
const requiredEnvVars = ["MONGOURL", "RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET"];
const missingEnvVars = requiredEnvVars.filter((envVar) => !process.env[envVar]);

if (missingEnvVars.length > 0) {
  console.warn(
    `⚠️ Missing required environment variables: ${missingEnvVars.join(", ")}`,
  );
  console.warn(
    `Will attempt to use Cloud Run environment variables if available`,
  );

  // Only exit if we're in development mode
  if (process.env.NODE_ENV === "development") {
    console.error("Exiting because running in development mode");
    process.exit(1);
  }
}

console.log(`🔧 Environment: ${process.env.NODE_ENV || "production"}`);
console.log(
  `💳 Razorpay Mode: ${process.env.RAZORPAY_KEY_ID?.includes("live") ? "PRODUCTION" : "TEST"}`,
);
console.log(
  `🗄️  Database: ${process.env.MONGOURL?.replace(/\/\/.*@/, "//***:***@") || "Not set"}`,
);

// ============================================
// REST OF YOUR SERVER CODE
// ============================================
const { connectDb } = require("./src/config/db");
const cookieParser = require("cookie-parser");
const { paymentRouter } = require("./src/routes/payment.routes");
const { adminRouter } = require("./src/routes/admin.routes");
const authRouter = require("./src/routes/auth.routes");
const cors = require("cors");
const helmet = require("helmet");
const { donationModle } = require("./src/models/donation.model");
const { sendPendingWhatsapp } = require("./src/services/whatsapp.service");
const cron = require("node-cron");
const { runDailyWishes } = require("./src/controllers/wish.controller");
const { runPendingReminders } = require("./src/controllers/pendingReminder.controller");

const app = express();

// Security headers — protects against clickjacking, MIME sniffing, etc.
app.use(helmet({
  contentSecurityPolicy: false, // Disabled to avoid breaking inline scripts/frontend
  crossOriginResourcePolicy: { policy: "cross-origin" }, // Allow frontend cross-origin
}));

// CORS configuration - FIXED (you had duplicate origin)
app.use(
  cors({
    origin: function (origin, callback) {
      const allowedOrigins = [
        "https://annadan.harekrishnavizag.org",
        "http://localhost:5173",
        "http://localhost:3000",
        "https://test.harekrishnavizag.org",
        "https://donations.harekrishnavizag.org",
        "https://subhojanam-client.vercel.app",
      ];
      // Allow requests with no origin (like mobile apps or curl)
      if (!origin) return callback(null, true);
      if (allowedOrigins.indexOf(origin) !== -1) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    credentials: true,
  }),
);

// Webhook endpoint (must be before express.json())
app.post(
  "/api/webhook/razorpay",
  express.raw({ type: "application/json" }),
  require("./src/controllers/webhook.controller").webHookControler.webhook,
);

// Regular middleware
app.use(express.json({ limit: "100kb" }));
app.use(cookieParser());

// Routes
app.use("/api/payment", paymentRouter);
app.use("/api/auth", authRouter);
app.use("/api/admin", adminRouter);
app.use("/api/public", require("./src/routes/public.routes").publicRouter);
app.use("/public", express.static("public"));

// Internal endpoint for pending reminders
app.get("/api/internal/send-pending-reminders", async (req, res) => {
  if (req.headers["x-internal-secret"] !== process.env.INTERNAL_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const cutoff = new Date(Date.now() - 6 * 60 * 1000);
    const pendingDonations = await donationModle.find({
      status: "created",
      createdAt: { $lte: cutoff },
      whatsappPendingReminderSent: { $ne: true },
    });

    console.log(
      `Reminder check: found ${pendingDonations.length} pending donations`,
    );

    for (const donation of pendingDonations) {
      try {
        const raw = donation.mobile.replace(/^\+/, "");
        const phone = raw.startsWith("91") ? raw : `91${raw}`;
        await sendPendingWhatsapp(phone, donation.name, donation.amount);
        donation.whatsappPendingReminderSent = true;
        await donation.save();
        console.log(`Reminder sent to ${phone} for donation ${donation._id}`);
      } catch (err) {
        console.error(
          "Failed for donation",
          donation._id,
          err.response?.data || err.message,
        );
      }
    }

    res.json({ success: true, processed: pendingDonations.length });
  } catch (err) {
    console.error("Reminder job error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Health check endpoint
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    environment: process.env.NODE_ENV || "production",
    razorpay_mode: process.env.RAZORPAY_KEY_ID?.includes("live")
      ? "production"
      : "test",
  });
});

// Start server
const server = async () => {
  try {
    await connectDb();
    const PORT = process.env.PORT || 8080;
    app.listen(PORT, () => {
      console.log(`🚀 Server connected on port ${PORT}`);
      console.log(`📍 API URL: http://localhost:${PORT}`);
      console.log(
        `🔗 Webhook URL: http://localhost:${PORT}/api/webhook/razorpay`,
      );

      // Daily Birthday/Anniversary wish job — 8:00 AM IST every day
      cron.schedule(
        "0 8 * * *",
        async () => {
          console.log("⏰ Running daily birthday/anniversary wishes...");
          try {
            await runDailyWishes();
          } catch (err) {
            console.error("Daily wishes cron error:", err.message);
          }
        },
        { timezone: "Asia/Kolkata" },
      );
      console.log("📅 Daily wishes cron scheduled for 8:00 AM IST");

      // Pending payment reminder job — every 15 minutes
      cron.schedule(
        "*/15 * * * *",
        async () => {
          try {
            await runPendingReminders();
          } catch (err) {
            console.error("Pending reminders cron error:", err.message);
          }
        },
        { timezone: "Asia/Kolkata" },
      );
      console.log("📅 Pending payment reminders cron scheduled every 15 minutes");
    });
  } catch (error) {
    console.log("❌ Server disconnected", error);
    process.exit(1);
  }
};

server();
