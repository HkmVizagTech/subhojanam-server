const axios = require("axios");
const FormData = require("form-data");
const fs = require("fs");
require("dotenv").config();

const sendPendingWhatsapp = async (phone, donorName, amount) => {
  const response = await axios.post(
    "https://wapi.flaxxa.com/api/v1/sendtemplatemessage",
    {
      token: process.env.FLAXXA_TOKEN,
      phone: phone,
      template_name: "subhojanam_seva_pending",
      template_language: "en",
      components: [
        {
          type: "header",
          parameters: [
            {
              type: "image",
              image: {
                link: "https://storage.googleapis.com/subhojanam/Avail%2080G%20Exemption%20(1).jpg",
              },
            },
          ],
        },
        {
          type: "body",
          parameters: [
            { type: "text", text: String(donorName) },
            { type: "text", text: String(amount) },
            { type: "text", text: "Annadana Seva" },
            {
              type: "text",
              text: "Once completed, the amount will be allocated towards providing meals",
            },
          ],
        },
      ],
    },
    { headers: { "Content-Type": "application/json" } },
  );

  return response.data;
};

// const sendReceiptWhatsapp = async (phone, filePath, donorName, amount, paymentType = "normal") => {

//   const form = new FormData();

//   form.append("token", process.env.FLAXXA_TOKEN);
//   form.append("phone", phone);

//   let templateName = "annadana_acknowledgement_receipt";
//   if (paymentType === "subscription") {
//     templateName = "andseva_monthly_success_reciept";
//   }
//   form.append("template_name", templateName);
//   form.append("template_language", "en");

//   form.append(
//     "components",
//     JSON.stringify([
//       {
//         type: "body",
//         parameters: [
//           {
//             type: "text",
//             text: donorName
//           },
//           {
//             type: "text",
//             text: String(amount)
//           }
//         ]
//       }
//     ])
//   );

//   form.append(
//     "header_attachment",
//     fs.createReadStream(filePath),
//       {
//         filename: "Donation_Acknowledgment_Receipt.pdf",
//         contentType: "application/pdf"
//       }
//   );

//   const response = await axios.post(
//     "https://wapi.flaxxa.com/api/v1/sendtemplatemessage_withattachment",
//     form,
//     {
//       headers: form.getHeaders()
//     }
//   );

//   return response.data;
// };

const sendReceiptWhatsapp = async (
  phone,
  filePath,
  donorName,
  amount,
  paymentType = "normal",
) => {
  const form = new FormData();

  form.append("token", process.env.FLAXXA_TOKEN);
  form.append("phone", phone);

  let templateName = "common_donation_success_reciept"; // Updated template name
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
            text: donorName, // 1st parameter: Name
          },
          {
            type: "text",
            text: String(amount), // 2nd parameter: Amount
          },
          {
            type: "text",
            text: "Annadana Seva", // 3rd parameter: Hardcoded service name
          },
        ],
      },
    ]),
  );

  form.append("header_attachment", fs.createReadStream(filePath), {
    filename: "Donation_Acknowledgment_Receipt.pdf",
    contentType: "application/pdf",
  });

  const response = await axios.post(
    "https://wapi.flaxxa.com/api/v1/sendtemplatemessage_withattachment",
    form,
    {
      headers: form.getHeaders(),
    },
  );

  return response.data;
};


const sendPrasadamDispatchWhatsapp = async (phone, donorName, trackingNumber = "") => {
  const response = await axios.post(
    "https://wapi.flaxxa.com/api/v1/sendtemplatemessage",
    {
      apikey: process.env.FLAXXA_API_KEY,
      to: phone,
      template_name: "prasadam_dispatch_notification",
      template_language: "en",
      components: [
        {
          type: "body",
          parameters: [
            { type: "text", text: donorName },
            { type: "text", text: trackingNumber || "Will be shared shortly" },
          ],
        },
      ],
    },
    { headers: { "Content-Type": "application/json" } }
  );
  return response.data;
};

const sendBirthdayWishWhatsapp = async (phone, donorName) => {
  const response = await axios.post(
    "https://wapi.flaxxa.com/api/v1/sendtemplatemessage",
    {
      token: process.env.FLAXXA_TOKEN,
      phone: phone,
      template_name: "birthday_wish_donation_ask",
      template_language: "en",
      components: [
        {
          type: "body",
          parameters: [{ type: "text", text: String(donorName) }],
        },
      ],
    },
    { headers: { "Content-Type": "application/json" } },
  );
  return response.data;
};

const sendAnniversaryWishWhatsapp = async (phone, donorName) => {
  const response = await axios.post(
    "https://wapi.flaxxa.com/api/v1/sendtemplatemessage",
    {
      token: process.env.FLAXXA_TOKEN,
      phone: phone,
      template_name: "anniversary_wish_donation_ask",
      template_language: "en",
      components: [
        {
          type: "body",
          parameters: [{ type: "text", text: String(donorName) }],
        },
      ],
    },
    { headers: { "Content-Type": "application/json" } },
  );
  return response.data;
};

// Celebratory "special day" wish sent directly to the honoree (sevak) — for happy occasions
// (Birthday, Anniversary, or any custom "Other" text). NOT used for Memorial — see the
// memorial-specific pair below, which uses solemn wording instead.
// {{1}} = sevakName, {{2}} = occasion
const sendCelebrationWishToSevak = async (phone, sevakName, occasion) => {
  const response = await axios.post(
    "https://wapi.flaxxa.com/api/v1/sendtemplatemessage",
    {
      token: process.env.FLAXXA_TOKEN,
      phone,
      template_name: "celebration_wish_to_sevak_v",
      template_language: "en",
      components: [
        {
          type: "header",
          parameters: [
            {
              type: "image",
              image: { link: "https://res.cloudinary.com/ddmzeqpkc/image/upload/f_auto,q_auto/celebration_jdgpi3" },
            },
          ],
        },
        {
          type: "body",
          parameters: [
            { type: "text", text: String(sevakName) },
            { type: "text", text: String(occasion) },
          ],
        },
      ],
    },
    { headers: { "Content-Type": "application/json" } }
  );
  return response.data;
};

// Celebratory wish sent to the donor, mentioning the honoree's name — used when no honoree
// mobile was given. {{1}} = donorName, {{2}} = sevakName, {{3}} = occasion
const sendCelebrationWishToDonor = async (phone, donorName, sevakName, occasion) => {
  const response = await axios.post(
    "https://wapi.flaxxa.com/api/v1/sendtemplatemessage",
    {
      token: process.env.FLAXXA_TOKEN,
      phone,
      template_name: "celebration_wish_to_donor_v2",
      template_language: "en",
      components: [
        {
          type: "header",
          parameters: [
            {
              type: "image",
              image: { link: "https://res.cloudinary.com/ddmzeqpkc/image/upload/f_auto,q_auto/celebration_jdgpi3" },
            },
          ],
        },
        {
          type: "body",
          parameters: [
            { type: "text", text: String(donorName) },
            { type: "text", text: String(sevakName) },
            { type: "text", text: String(occasion) },
          ],
        },
      ],
    },
    { headers: { "Content-Type": "application/json" } }
  );
  return response.data;
};

// Solemn wish sent to a family member (the "sevak" fields, for Memorial, represent someone
// notifying on behalf of the deceased — not the deceased's own number) — no "occasion" variable
// needed since the wording is always framed around remembrance. {{1}} = the person being remembered
const sendMemorialWishToSevak = async (phone, sevakName) => {
  const response = await axios.post(
    "https://wapi.flaxxa.com/api/v1/sendtemplatemessage",
    {
      token: process.env.FLAXXA_TOKEN,
      phone,
      template_name: "memorial_wish_to_sevak_v2",
      template_language: "en",
      components: [
        {
          type: "header",
          parameters: [
            {
              type: "image",
              image: { link: "https://res.cloudinary.com/ddmzeqpkc/image/upload/f_auto,q_auto/memorial_p6bu9c" },
            },
          ],
        },
        {
          type: "body",
          parameters: [{ type: "text", text: String(sevakName) }],
        },
      ],
    },
    { headers: { "Content-Type": "application/json" } }
  );
  return response.data;
};

// Solemn wish sent to the donor, mentioning who is being remembered — used when no family
// contact mobile was given. {{1}} = donorName, {{2}} = the person being remembered
const sendMemorialWishToDonor = async (phone, donorName, sevakName) => {
  const response = await axios.post(
    "https://wapi.flaxxa.com/api/v1/sendtemplatemessage",
    {
      token: process.env.FLAXXA_TOKEN,
      phone,
      template_name: "memorial_wish_to_donor_v2",
      template_language: "en",
      components: [
        {
          type: "header",
          parameters: [
            {
              type: "image",
              image: { link: "https://res.cloudinary.com/ddmzeqpkc/image/upload/f_auto,q_auto/memorial_p6bu9c" },
            },
          ],
        },
        {
          type: "body",
          parameters: [
            { type: "text", text: String(donorName) },
            { type: "text", text: String(sevakName) },
          ],
        },
      ],
    },
    { headers: { "Content-Type": "application/json" } }
  );
  return response.data;
};

module.exports = {
  sendReceiptWhatsapp,
  sendPendingWhatsapp,
  sendPrasadamDispatchWhatsapp,
  sendBirthdayWishWhatsapp,
  sendAnniversaryWishWhatsapp,
  sendCelebrationWishToSevak,
  sendCelebrationWishToDonor,
  sendMemorialWishToSevak,
  sendMemorialWishToDonor,
};
