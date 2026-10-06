const puppeteer = require("puppeteer");
const ejs = require("ejs");
const fs = require("fs");
const path = require("path");
const { settingsModel } = require("../models/settings.model");
const { donationModle } = require("../models/donation.model");
const { istDateDDMMYYYY, istYear } = require("../config/timezone");
const numberToWords = require("number-to-words");

let sharedBrowser = null;

const getBrowser = async () => {
  if (sharedBrowser) {
    try {
      await sharedBrowser.version();
      return sharedBrowser;
    } catch {
      sharedBrowser = null;
    }
  }
  sharedBrowser = await puppeteer.launch({
    headless: true,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || "/usr/bin/chromium",
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--disable-software-rasterizer",
      "--disable-extensions",
      "--disable-crash-reporter",
      "--crash-dumps-dir=/tmp",
    ],
  });
  return sharedBrowser;
};

const generatePDF = async (html, filePath) => {
  // Try up to 2 times — on failure, reset browser and retry once
  for (let attempt = 1; attempt <= 2; attempt++) {
    let page = null;
    try {
      const browser = await getBrowser();
      page = await browser.newPage();
      await page.setContent(html, { waitUntil: "networkidle0", timeout: 30000 });
      await page.pdf({
        path: filePath,
        format: "A4",
        printBackground: true,
        margin: { top: 0, right: 0, bottom: 0, left: 0 },
      });
      return; // success
    } catch (err) {
      console.error(`PDF attempt ${attempt} failed:`, err.message);
      // Reset browser so next attempt gets a fresh one
      try { await sharedBrowser?.close(); } catch {}
      sharedBrowser = null;
      if (attempt === 2) throw err; // rethrow on second failure
    } finally {
      try { await page?.close(); } catch {}
    }
  }
};

/**
 * The instant the donation actually happened.
 *
 * Everything a receipt says about "when" has to come from here, not from the
 * clock. `createdAt` is set by mongoose timestamps on online donations and is
 * set explicitly from the entered payment date on offline ones raised in DRM,
 * so it is the one field that means "when the money came in" on both paths.
 *
 * Falls back to now only if a caller passes an object with no usable date,
 * which no production path does.
 */
const donationInstant = (donation) => {
  const raw = donation?.createdAt;
  if (raw) {
    const d = raw instanceof Date ? raw : new Date(raw);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return new Date();
};

const generateReceipt = async (donation, apiResponse = null) => {
  try {
    console.log("Receipt generation started for donation:", donation._id);

    let settings = await settingsModel.findOne();
    if (!settings) {
      settings = await settingsModel.create({
        receiptSettings: { startNumber: 5000, currentReceiptNumber: 5000 },
      });
    }

    let apiResp = apiResponse;
    if (!apiResp) {
      if (donation.externalApiResponse) {
        apiResp = donation.externalApiResponse;
      } else {
        try {
          const fresh = await donationModle
            .findById(donation._id)
            .select("externalApiResponse")
            .lean();
          if (fresh?.externalApiResponse) apiResp = fresh.externalApiResponse;
        } catch (e) {
          console.warn("Could not load externalApiResponse:", e.message || e);
        }
      }
    }

    // Every date on this certificate is the donation's own date in IST, never
    // the clock at the moment the PDF happens to be rendered. See below.
    const donatedAt = donationInstant(donation);

    let formattedReceiptNumber;
    if (apiResp?.ReceiptNumber) {
      formattedReceiptNumber = apiResp.ReceiptNumber;
      console.log("✅ Using API receipt number:", formattedReceiptNumber);
    } else {
      // The year in the fallback receipt number was `new Date().getFullYear()`:
      // the UTC year, at generation time. Both halves were wrong. A donation
      // made in the 00:00–05:30 IST window on 1 January was still the previous
      // year in UTC, so it got the previous year baked permanently into its
      // receipt number; and taking the year from generation time rather than
      // from the donation meant a receipt produced in January for a December
      // donation was numbered in the wrong year too.
      const receiptYear = istYear(donatedAt);

      // Allocating the number used to be a read-modify-write across two calls:
      // read currentReceiptNumber, then write currentReceiptNumber + 1. Two
      // receipts generated at the same time read the same value and both took
      // it, so two different donors could be issued the same receipt number on
      // a legal 80G document. A single findOneAndUpdate with $inc makes the
      // allocation atomic — each caller gets a number nobody else can get.
      //
      // $inc returns the number AFTER incrementing, so the one to use is the
      // value it replaced, exactly as the old code used the pre-increment value.
      if (typeof settings.receiptSettings?.currentReceiptNumber !== "number") {
        // Seed only if it has never been set, and only once: the filter is part
        // of the update, so concurrent callers cannot both seed it.
        await settingsModel.updateOne(
          {
            _id: settings._id,
            "receiptSettings.currentReceiptNumber": { $not: { $type: "number" } },
          },
          {
            $set: {
              "receiptSettings.currentReceiptNumber":
                settings.receiptSettings?.startNumber ?? 1000,
            },
          },
        );
      }

      const bumped = await settingsModel.findOneAndUpdate(
        { _id: settings._id },
        { $inc: { "receiptSettings.currentReceiptNumber": 1 } },
        { new: true, projection: { "receiptSettings.currentReceiptNumber": 1 } },
      );
      const localNumber = bumped.receiptSettings.currentReceiptNumber - 1;

      formattedReceiptNumber = `HKMI|${receiptYear}|D/VSP|${String(localNumber).padStart(5, "0")}`;
      console.log("⚠️ Using local receipt number:", formattedReceiptNumber);
    }

    // This was `new Date().toLocaleDateString("en-GB")`, and it fed both the
    // receipt date and the payment date on the certificate. Two bugs in one
    // line. It had no timezone, so it printed the UTC day and a donation at 2am
    // IST was certified as having been made the day before. And it was the
    // clock, not the donation: a receipt regenerated later, or a backdated
    // offline donation entered from DRM, printed TODAY as the date the money
    // came in. A reprint must show what the original showed, so both dates now
    // come from the donation's own timestamp, pinned to IST.
    const receiptDate = istDateDDMMYYYY(donatedAt);
    const addr = donation.address || donation.prasadamAddress || "";
    const addrCity = donation.city || donation.prasadamCity || "";
    const addrState = donation.state || donation.prasadamState || "";
    const addrPincode = donation.pincode || donation.prasadamPincode || "";
    // Empty parts dropped before joining. The fixed template printed
    // "9 Siripuram, Visakhapatnam,  - 530003" for an address with no state,
    // and ", ,  - " for one with nothing at all.
    const addrLine = [addr, addrCity, addrState].map((x) => String(x || "").trim()).filter(Boolean).join(", ");
    const address = addrPincode ? (addrLine ? `${addrLine} - ${addrPincode}` : String(addrPincode)) : addrLine;
    // How the money came in, printed after "by". The template said "Online"
    // on every receipt, including cash and cheque donations entered offline.
    const PAID_BY = { cash: "Cash", cheque: "Cheque", upi: "UPI", phonepe: "UPI", bank_transfer: "Bank" };
    const paidBy = donation.donationSource === "offline" ? PAID_BY[donation.offlinePaymentMode] || "Online" : "Online";

    const logoBase64 = fs.readFileSync(
      path.join(__dirname, "../public/hkmi-logo.jpg"),
      "base64",
    );
    const stampBase64 = fs.readFileSync(
      path.join(__dirname, "../public/hkmi-stamp-removebg-preview.png"),
      "base64",
    );

    const amountWords =
      numberToWords.toWords(donation.amount).toUpperCase() + " RUPEES ONLY";

    const templatePath = path.join(__dirname, "../templates/receipt.ejs");
    const html = await ejs.renderFile(templatePath, {
      receiptNumber: formattedReceiptNumber,
      receiptDate,
      donorName: donation.name || "Donor",
      address: address || "N/A",
      patronId: "",
      sevakName: donation.sevakName || "",
      donorNumber: apiResp?.DonorNumber || "",
      mobile: donation.mobile || "",
      certificate: donation.certificate === true ? "YES" : "NO",
      email: donation.email || "",
      pan: donation.panNumber || "",
      amount: donation.amount || 0,
      amountWords,
      // The UTR / cheque no. first, when there is one: it is what the donor
      // sees on their bank statement. A website payment has only the gateway id.
      paymentRef: donation.offlineRefNo || donation.razorpayPaymentId || "",
      paidBy,
      paymentDate: receiptDate,
      enrolledBy: apiResp?.EnrolledBy || apiResp?.EnrolledByName || "",
      cdc: apiResp?.CDC || apiResp?.CDCName || "",
      logoBase64,
      stampBase64,
      externalApiResponse: apiResp,
    });

    const receiptsDir = process.env.RECEIPTS_DIR || "/tmp/receipts";
    if (!fs.existsSync(receiptsDir)) {
      fs.mkdirSync(receiptsDir, { recursive: true });
    }

    const safeName = donation.name.replace(/[^a-zA-Z0-9]/g, "_").replace(/_+/g, "_").slice(0, 50);
    const filePath = path.join(receiptsDir, `Donation_Receipt_${safeName}.pdf`);

    await generatePDF(html, filePath);
    console.log("✅ PDF written to disk");

    // ✅ Only saved AFTER pdf is confirmed written
    await donationModle.findByIdAndUpdate(donation._id, {
      receiptNumber: formattedReceiptNumber,
      receiptGeneratedAt: new Date(),
    });

    console.log("Receipt PDF generated successfully!");

    // Tell DRM, whatever path raised this receipt - the offline donation
    // form, a missed or repaired subscription charge, a regenerated receipt.
    // Only the online webhook used to push, so a cash or cheque receipt raised
    // on this admin never reached DRM until somebody ran a full import there.
    // Fire-and-forget and never throws; DRM upserts by id, so a second push
    // for the same donation is harmless. Required here, not at the top, to
    // keep the services free of a require cycle.
    try {
      const { pushToDrm } = require("./drmNotify.service");
      pushToDrm(donation._id, { reason: "receipt_generated" });
    } catch (e) {
      console.warn("DRM push not started (non-fatal):", e && e.message ? e.message : e);
    }

    return filePath;
  } catch (error) {
    console.error("Error in generateReceipt:", error);
    throw error;
  }
};

module.exports = { generateReceipt };
