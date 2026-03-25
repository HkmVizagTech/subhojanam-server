
const axios = require("axios");
const FormData = require("form-data");
const fs = require("fs");
require("dotenv").config();

const sendPendingWhatsapp = async (phone, donorName, amount) => {

  console.log("donation details",phone,donorName,amount);

  const response = await axios.post(
    "https://wapi.flaxxa.com/api/v1/sendtemplatemessage",
    {
      token: process.env.FLAXXA_TOKEN,
      phone: phone,
      template_name: "subhojanam_ppending",
      template_language: "en",
      components: [
        {
          type: "body",
          parameters: [
            { type: "text", text: String(donorName).trim() },
            { type: "text", text: String(amount) }
          ]
        }
      ]
    },
    {
      headers: {
        "Content-Type": "application/json"
      }
    }
  );

  return response.data;
};



const sendReceiptWhatsapp = async (phone, filePath, donorName, amount, paymentType = "normal") => {

  const form = new FormData();

  form.append("token", process.env.FLAXXA_TOKEN);
  form.append("phone", phone);

  let templateName = "annadana_acknowledgement_receipt";
  if (paymentType === "subscription") {
    templateName = "andseva_monthly_success_reciept";
  }
  form.append("template_name", templateName);
  form.append("template_language", "en");


  form.append(
    "components",
    JSON.stringify([
      {
        type: "body",
        parameters: [
          {
            type: "text",
            text: donorName
          },
          {
            type: "text",
            text: String(amount)
          }
        ]
      }
    ])
  );

  form.append(
    "header_attachment",
    fs.createReadStream(filePath),
      {
        filename: "Donation_Acknowledgment_Receipt.pdf",
        contentType: "application/pdf"
      }
  );

  const response = await axios.post(
    "https://wapi.flaxxa.com/api/v1/sendtemplatemessage_withattachment",
    form,
    {
      headers: form.getHeaders()
    }
  );

  return response.data;
};

module.exports = { sendReceiptWhatsapp, sendPendingWhatsapp };
