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

    // Firestore test write
    const testRef = firestore.collection("test").doc("check");
    testRef
      .set({ time: Date.now() })
      .then(() => console.log("🔥 Firestore TEST WRITE: SUCCESS"))
      .catch((err) =>
        console.error("❌ Firestore TEST WRITE ERROR:", err.message || err)
      );
  } catch (err) {
    console.error("❌ Firebase init error:", err);
  }
} else {
  console.log("⚠️ Firestore not configured — tokens won't be saved.");
}

// =========================
// Save WhatsApp Integration to Firestore
// =========================
async function saveIntegration(uid, data) {
  if (!firestore || !uid) return;

  const ref = firestore
    .collection("users")
    .doc(uid)
    .collection("integrations")
    .doc("meta");

  await ref.set(
    { ...data, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
    { merge: true }
  );
}

// =========================
// Routes
// =========================

// Health check
app.get("/", (req, res) => {
  res.json({ status: "Mujeeb OAuth backend running" });
});

// OAuth start
app.get("/auth/start", (req, res) => {
  const uid = req.query.uid || "";
  const redirect = encodeURIComponent(REDIRECT_URI);

  const scope = encodeURIComponent(
    "whatsapp_business_management,whatsapp_business_messaging,pages_show_list"
  );

  const oauthUrl = `https://www.facebook.com/v16.0/dialog/oauth?client_id=${META_APP_ID}&redirect_uri=${redirect}&state=${uid}&scope=${scope}&response_type=code`;

  res.redirect(oauthUrl);
});

// OAuth callback
app.get("/auth/callback", async (req, res) => {
  try {
    const code = req.query.code;
    const state = req.query.state || "";

    if (!code) return res.status(400).send("Missing code");

    // Short-lived token
    const shortRes = await axios.get(
      `https://graph.facebook.com/v16.0/oauth/access_token?client_id=${META_APP_ID}&client_secret=${META_APP_SECRET}&redirect_uri=${encodeURIComponent(
        REDIRECT_URI
      )}&code=${encodeURIComponent(code)}`
    );

    const shortToken = shortRes.data?.access_token;
    if (!shortToken) throw new Error("Failed to get access token");

    // Long-lived token
    const longRes = await axios.get(
      `https://graph.facebook.com/v16.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${META_APP_ID}&client_secret=${META_APP_SECRET}&fb_exchange_token=${shortToken}`
    );

    const longToken = longRes.data?.access_token || shortToken;

    // WhatsApp Business data
    const whoRes = await axios.get(
      `https://graph.facebook.com/v16.0/me?fields=businesses{whatsapp_business_accounts{phone_numbers,id}}&access_token=${longToken}`
    );

    let waAccountId = null;
    let phoneNumber = null;

    const businesses = whoRes.data?.businesses || [];
    for (const b of businesses) {
      const wbas = b?.whatsapp_business_accounts || [];
      for (const w of wbas) {
        waAccountId = w.id;
        if (w.phone_numbers?.length) {
          phoneNumber = w.phone_numbers[0]?.phone_number;
        }
      }
    }

    // Save to Firestore
    if (state) {
      await saveIntegration(state, {
        access_token: longToken,
        whatsapp_business_account_id: waAccountId,
        phone_number: phoneNumber,
        linkedAt: new Date().toISOString(),
      });
      console.log("✅ Saved integration for UID:", state);
    }

    res.redirect(`${process.env.FRONTEND_URL || "/"}?connected=1`);
  } catch (err) {
    console.error("OAuth error:", err.response?.data || err);
    res.status(500).send("OAuth failed");
  }
});

// Fetch stored WhatsApp token
app.get("/auth/token", async (req, res) => {
  try {
    const uid = req.query.uid;

    if (!uid) return res.status(400).send({ error: "Missing uid" });
    if (!firestore) return res.status(500).send({ error: "Firestore disabled" });

    const ref = firestore
      .collection("users")
      .doc(uid)
      .collection("integrations")
      .doc("meta");

    const snap = await ref.get();
    if (!snap.exists) return res.status(404).send({ error: "No token found" });

    res.json(snap.data());
  } catch (err) {
    console.error("Token error:", err);
    res.status(500).send({ error: err.message });
  }
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
// Webhook receive (FINAL VERSION)
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

      console.log("📩 رسالة واردة:", userMessage);

      const WA_TOKEN = process.env.WHATSAPP_TOKEN;

      await axios.post(
        `https://graph.facebook.com/v19.0/${phoneNumberId}/messages`,
        {
          messaging_product: "whatsapp",
          to: from,
          text: { body: `تم استلام رسالتك: ${userMessage}` },
        },
        {
          headers: {
            Authorization: `Bearer ${WA_TOKEN}`,
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
// Firestore test route
// =========================
app.get("/test-firestore", async (req, res) => {
  try {
    if (!firestore)
      return res.status(500).json({ success: false, message: "Firestore inactive" });

    const ref = firestore.collection("_test").doc("connectivity-check");

    await ref.set({
      timestamp: new Date().toISOString(),
      message: "Hello from backend",
    });

    const snap = await ref.get();
    res.json({ success: true, data: snap.data() });
  } catch (err) {
    console.error("Firestore test error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// =========================
// Start server
// =========================
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Mujeeb OAuth server running on ${PORT}`);
});
