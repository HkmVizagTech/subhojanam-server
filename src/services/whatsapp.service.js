const axios = require("axios");
const FormData = require("form-data");
const fs = require("fs");
require("dotenv").config();

const sendReceiptWhatsapp = async (phone, filePath, donorName, amount, paymentType = "normal") => {

  const form = new FormData();

  form.append("token", process.env.FLAXXA_TOKEN);
  form.append("phone", phone);

  let templateName = "annadana_acknowledgement_receipt";
  if (paymentType === "subscription") {
    templateName = "andseva_monthly_success_reciept";
  }
  form.append("template_name", templateName);
  form.append("template_language", "en_GB");


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
        filename: "Annadhan_Certificate.pdf",
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

module.exports = { sendReceiptWhatsapp };
