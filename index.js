const express = require("express");
require("dotenv").config();
const { connectDb } = require("./src/config/db");
const cookieParser = require("cookie-parser");
const { paymentRouter } = require("./src/routes/payment.routes");
const { adminRouter } = require("./src/routes/admin.routes");
const authRouter = require("./src/routes/auth.routes");
const cors = require("cors")
require("dotenv").config();

const app = express();


app.use(cors({
  origin: ["http://localhost:5173", "http://localhost:5174"],
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

const server = async () => {
  try {
    await connectDb();
    app.listen(process.env.PORT, () => {
      console.log(`server connected on port ${process.env.PORT}`);
    });
  } catch (error) {
    console.log("server disconnected", error);
  }
};

server();
