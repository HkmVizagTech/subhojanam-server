const express = require("express");
require("dotenv").config();
const { connectDb } = require("./src/config/db");
const cookieParser = require("cookie-parser");
const { paymentRouter } = require("./src/routes/payment.routes");
const { adminRouter } = require("./src/routes/admin.routes");
const authRouter = require("./src/routes/auth.routes");
const cors = require("cors");
const { donationModle } = require("./src/models/donation.model");
const { sendPendingWhatsapp } = require("./src/services/whatsapp.service");

// const debugRouter = require("./src/routes/debug.routes");

const app = express();

app.use(cors({
  origin: ["https://annadan.harekrishnavizag.org"],
  //origin: ["http://localhost:5173"],
  methods: ["GET", "POST", "PUT", "DELETE"],
  credentials: true
}));

app.post(
  "/api/webhook/razorpay",
  express.raw({ type: "application/json" }),
  require("./src/controllers/webhook.controller").webHookControler.webhook
);

app.use(express.json());
app.use(cookieParser());

app.use("/api/payment", paymentRouter);
app.use("/api/auth", authRouter);
app.use("/api/admin", adminRouter);
app.use("/public", express.static("public"));


// app.use("/api/admin", debugRouter);
// app.use("/api/admin", require("./src/routes/debug-utm-count.routes"));

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

    console.log(`Reminder check: found ${pendingDonations.length} pending donations`);

    for (const donation of pendingDonations) {
      try {
        const raw = donation.mobile.replace(/^\+/, "");
        const phone = raw.startsWith("91") ? raw : `91${raw}`;
        await sendPendingWhatsapp(phone, donation.name, donation.amount);
        donation.whatsappPendingReminderSent = true;
        await donation.save();
        console.log(`Reminder sent to ${phone} for donation ${donation._id}`);
      } catch (err) {
        console.error("Failed for donation", donation._id, err.response?.data || err.message);
      }
    }

    res.json({ success: true, processed: pendingDonations.length });
  } catch (err) {
    console.error("Reminder job error:", err);
    res.status(500).json({ error: err.message });
  }
});

const server = async () => {
  try {
    await connectDb();
    const PORT = process.env.PORT || 8080;
    app.listen(PORT, () => {
      console.log(`server connected on port ${PORT}`);
    });
  } catch (error) {
    console.log("server disconnected", error);
  }
};

server();

