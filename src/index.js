// backend/src/index.js

import express from "express";
import dotenv from "dotenv";
import bodyParser from "body-parser";
import axios from "axios";
import cors from "cors";
import admin from "firebase-admin";

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
const META_APP_ID = process.env.META_APP_ID;
const META_APP_SECRET = process.env.META_APP_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI;
const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID;
const FIREBASE_CLIENT_EMAIL = process.env.FIREBASE_CLIENT_EMAIL;
const FIREBASE_PRIVATE_KEY =
  process.env.FIREBASE_PRIVATE_KEY &&
  process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n");

const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN; // <-- الوحيد الذي نستخدمه

// =========================
// Firebase Admin initialization
// =========================
let firestore = null;

if (FIREBASE_PROJECT_ID && FIREBASE_CLIENT_EMAIL && FIREBASE_PRIVATE_KEY) {
  try {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: FIREBASE_PROJECT_ID,
        clientEmail: FIREBASE_CLIENT_EMAIL,
        privateKey: FIREBASE_PRIVATE_KEY,
      }),
    });

    firestore = admin.firestore();
    console.log("🔥 Firestore initialized successfully!");
  } catch (err) {
    console.error("❌ Firebase init error:", err);
  }
} else {
  console.log("⚠️ Firestore not configured — tokens won't be saved.");
}

// =========================
// Routes
// =========================

// Health check
app.get("/", (req, res) => {
  res.json({ status: "Mujeeb backend running" });
});

// =========================
// Webhook verify (needed by Meta)
// =========================
app.get("/webhook", (req, res) => {
  const verifyToken = process.env.META_VERIFY_TOKEN || "mujeeb_test";
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === verifyToken) {
    return res.status(200).send(challenge);
  }

  res.sendStatus(403);
});

// =========================
// Webhook receive
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

      // -------------------------
      // إرسال الرد عبر WHATSAPP_TOKEN
      // -------------------------
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

      console.log("✅ تم إرسال الرد");
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
