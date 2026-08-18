const nodemailer = require("nodemailer");

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;

  if (!process.env.OUTLOOK_EMAIL || !process.env.OUTLOOK_APP_PASSWORD) {
    throw new Error("OUTLOOK_EMAIL or OUTLOOK_APP_PASSWORD not configured");
  }

  transporter = nodemailer.createTransport({
    host: "smtp-mail.outlook.com", // personal Outlook.com / Hotmail / Live account
    port: 587,
    secure: false, // STARTTLS on port 587
    auth: {
      user: process.env.OUTLOOK_EMAIL,
      pass: process.env.OUTLOOK_APP_PASSWORD,
    },
    tls: {
      ciphers: "SSLv3",
    },
  });

  return transporter;
}

/**
 * Sends a pending-payment reminder email to a donor whose donation is
 * still stuck in "created" status.
 */
async function sendPendingPaymentEmail(toEmail, donorName, amount, donationType = "one-time") {
  const t = getTransporter();

  const donateUrl = "https://annadan.harekrishnavizag.org";

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; background: #FEF2E1; border-radius: 12px;">
      <h2 style="color: #0A97EF; margin-bottom: 4px;">Hare Krishna ${donorName} 🙏</h2>
      <p style="font-size: 15px; color: #333; line-height: 1.6;">
        We noticed your ${donationType} donation of <strong>₹${amount}</strong> towards Annadana Seva
        was started but not completed.
      </p>
      <p style="font-size: 15px; color: #333; line-height: 1.6;">
        Every meal you sponsor brings hope to someone in need. If you'd like to complete your donation,
        please click below:
      </p>
      <div style="text-align: center; margin: 24px 0;">
        <a href="${donateUrl}" style="background: #0A97EF; color: white; padding: 12px 28px; border-radius: 8px; text-decoration: none; font-weight: bold; display: inline-block;">
          Complete Donation
        </a>
      </div>
      <p style="font-size: 13px; color: #888;">
        If you've already completed this donation via another method, please ignore this email.
      </p>
      <p style="font-size: 13px; color: #888; margin-top: 20px;">
        Hare Krishna Movement, Visakhapatnam<br/>
        annadan.harekrishnavizag.org
      </p>
    </div>
  `;

  const info = await t.sendMail({
    from: `"Hare Krishna Movement Vizag" <${process.env.OUTLOOK_EMAIL}>`,
    to: toEmail,
    subject: "Your Annadana Seva donation is pending 🙏",
    html,
  });

  return info;
}

module.exports = { sendPendingPaymentEmail };
