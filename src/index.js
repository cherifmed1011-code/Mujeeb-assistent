// backend/src/index.js

import express from "express";
import dotenv from "dotenv";
import bodyParser from "body-parser";
import axios from "axios";
import cors from "cors";

dotenv.config();

// =========================
// Express setup
// =========================
const app = express();
app.use(cors());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

const PORT = process.env.PORT || 10000;

// =========================
// Environment Variables
// =========================
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN; // ← التوكن الوحيد المستخدم
const META_VERIFY_TOKEN = process.env.META_VERIFY_TOKEN || "mujeeb_test";

// =========================
// Health check
// =========================
app.get("/", (req, res) => {
  res.json({ status: "Mujeeb backend running" });
});

// =========================
// Webhook verify (Meta requirement)
// =========================
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === META_VERIFY_TOKEN) {
    console.log("Webhook verified successfully!");
    return res.status(200).send(challenge);
  }

  res.sendStatus(403);
});

// =========================
// Webhook receiver
// =========================
app.post("/webhook", async (req, res) => {
  try {
    const body = req.body;

    if (
      body.object === "whatsapp_business_account" &&
      body.entry &&
      body.entry[0].changes &&
      body.entry[0].changes[0].value.messages
    ) {
      const change = body.entry[0].changes[0].value;
      const message = change.messages[0];

      const from = message.from;
      const userMessage = message.text?.body || "";
      const phoneNumberId = change.metadata.phone_number_id;

      console.log("📩 واردة:", userMessage);
      console.log("📞 phone_number_id المستلم:", phoneNumberId);

      // إرسال الرد
      await axios.post(
        `https://graph.facebook.com/v19.0/${phoneNumberId}/messages`,
        {
          messaging_product: "whatsapp",
          to: from,
          text: { body: `تم استلام رسالتك: ${userMessage}` },
        },
        {
          headers: {
            Authorization: `Bearer ${WHATSAPP_TOKEN}`,
            "Content-Type": "application/json",
          },
        }
      );

      console.log("✅ تم إرسال الرد للمستخدم");
    }

    res.sendStatus(200);
  } catch (err) {
    console.error("❌ Webhook error:", err.response?.data || err);
    res.sendStatus(500);
  }
});

// =========================
// Start server
// =========================
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Mujeeb server running on port ${PORT}`);
});
