// backend/src/index.js
import express from "express";
import dotenv from "dotenv";
import bodyParser from "body-parser";
import axios from "axios";
import cors from "cors";
import admin from "firebase-admin"; // 🔥 مهم جداً

dotenv.config();
const app = express();
app.use(cors());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

const PORT = process.env.PORT || 10000;

// --- Meta / OAuth environment variables ---
const META_APP_ID = process.env.META_APP_ID;
const META_APP_SECRET = process.env.META_APP_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI;
const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID;
const FIREBASE_CLIENT_EMAIL = process.env.FIREBASE_CLIENT_EMAIL;
const FIREBASE_PRIVATE_KEY =
  process.env.FIREBASE_PRIVATE_KEY &&
  process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n");

// --- Firebase Admin initialization ---
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

// --- Helper: Save OAuth tokens ---
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

// Start OAuth
app.get("/auth/start", (req, res) => {
  const uid = req.query.uid || "";
  const state = uid;

  const scope = encodeURIComponent(
    "whatsapp_business_management,whatsapp_business_messaging,pages_show_list"
  );

  const redirect = encodeURIComponent(REDIRECT_URI);
  const oauthUrl = `https://www.facebook.com/v16.0/dialog/oauth?client_id=${META_APP_ID}&redirect_uri=${redirect}&state=${encodeURIComponent(
    state
  )}&scope=${scope}&response_type=code`;

  return res.redirect(oauthUrl);
});

// OAuth callback
app.get("/auth/callback", async (req, res) => {
  try {
    const code = req.query.code;
    const state = req.query.state || "";

    if (!code) return res.status(400).send("Missing code");

    // 1) Exchange for short-lived token
    const tokenUrl =
      `https://graph.facebook.com/v16.0/oauth/access_token` +
      `?client_id=${META_APP_ID}` +
      `&client_secret=${META_APP_SECRET}` +
      `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
      `&code=${encodeURIComponent(code)}`;

    const shortRes = await axios.get(tokenUrl);
    const shortToken = shortRes.data?.access_token;

    if (!shortToken) throw new Error("Failed to get access token");

    // 2) Exchange for long-lived token
    const longUrl =
      `https://graph.facebook.com/v16.0/oauth/access_token` +
      `?grant_type=fb_exchange_token&client_id=${META_APP_ID}` +
      `&client_secret=${META_APP_SECRET}` +
      `&fb_exchange_token=${encodeURIComponent(shortToken)}`;

    const longRes = await axios.get(longUrl);
    const longToken = longRes.data?.access_token || shortToken;

    // 3) Get WhatsApp Business account
    const fields = encodeURIComponent(
      "businesses{whatsapp_business_accounts{phone_numbers,id}}"
    );

    const whoUrl = `https://graph.facebook.com/v16.0/me?fields=${fields}&access_token=${longToken}`;
    const whoRes = await axios.get(whoUrl);

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

    return res.redirect(`${process.env.FRONTEND_URL || "/"}?connected=1`);
  } catch (err) {
    console.error("OAuth error:", err.response?.data || err);
    return res.status(500).send("OAuth failed");
  }
});

// Get token
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

    return res.json(snap.data());
  } catch (err) {
    console.error("Token error:", err);
    return res.status(500).send({ error: err.message });
  }
});

// Webhook verification
app.get("/webhook", (req, res) => {
  const verifyToken = process.env.META_VERIFY_TOKEN || "mujeeb_test";
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode && token && mode === "subscribe" && token === verifyToken) {
    return res.status(200).send(challenge);
  }

  return res.sendStatus(403);
});

// Actual webhook receiver
app.post("/webhook", (req, res) => {
  console.log("📩 Webhook:", JSON.stringify(req.body, null, 2));
  res.sendStatus(200);
});

// Test Firestore
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

    return res.json({
      success: true,
      data: snap.data(),
    });
  } catch (err) {
    console.error("Firestore test error:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Mujeeb OAuth server running on ${PORT}`);
});
