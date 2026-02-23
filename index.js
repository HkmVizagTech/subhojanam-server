const express = require("express");
const { connectDb } = require("./src/config/db");
const cookieParser = require("cookie-parser");
const { paymentRouter } = require("./src/routes/payment.routes");
const { webHookRouter } = require("./src/routes/webhook.routes");
const cors = require("cors")
require("dotenv").config();

const app = express();


app.use(cors());
app.use("/api/webhook", webHookRouter);
app.use(express.json());
app.use(cookieParser());

app.use("/api/payment", paymentRouter);

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
