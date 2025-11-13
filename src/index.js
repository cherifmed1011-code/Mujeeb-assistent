// backend/src/index.js
import express from "express";
import dotenv from "dotenv";
import bodyParser from "body-parser";
import axios from "axios";
import cors from "cors";
import "./auth.js";

dotenv.config();
const app = express();
app.use(cors());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

const PORT = process.env.PORT || 10000;
const META_APP_ID = process.env.META_APP_ID;
const META_APP_SECRET = process.env.META_APP_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI; // e.g. https://mujeeb-assistent.onrender.com/auth/callback
const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID;
const FIREBASE_CLIENT_EMAIL = process.env.FIREBASE_CLIENT_EMAIL;
const FIREBASE_PRIVATE_KEY =
  process.env.FIREBASE_PRIVATE_KEY &&
  process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n");

// --- (اختياري) تهيئة Firebase Admin لحفظ التوكنات ---
let firestore = null;
if (FIREBASE_PROJECT_ID && FIREBASE_CLIENT_EMAIL && FIREBASE_PRIVATE_KEY) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: FIREBASE_PROJECT_ID,
      clientEmail: FIREBASE_CLIENT_EMAIL,
      privateKey: FIREBASE_PRIVATE_KEY,
    }),
  });
  firestore = admin.firestore();
  console.log("✅ Firestore initialized");
} else {
  console.log("⚠️ Firestore not configured — tokens won't be saved automatically.");
}

// helper to save credentials
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

// --- Routes ---
// health
app.get("/", (req, res) =>
  res.json({ status: "✅ Mujeeb backend (OAuth) running" })
);

// Start OAuth flow
// FRONTEND should call: GET /auth/start?uid=<USER_UID>
app.get("/auth/start", (req, res) => {
  const uid = req.query.uid || ""; // optional: link to your user
  const state = uid; // we pass uid as state
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
    const state = req.query.state || ""; // user id passed from /auth/start
    if (!code) return res.status(400).send("Missing code");

    // 1) Exchange code for short-lived token
    const tokenExchangeUrl =
      `https://graph.facebook.com/v16.0/oauth/access_token` +
      `?client_id=${META_APP_ID}` +
      `&client_secret=${META_APP_SECRET}` +
      `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
      `&code=${encodeURIComponent(code)}`;

    const tokenRes = await axios.get(tokenExchangeUrl);
    const shortLivedToken = tokenRes.data?.access_token;
    if (!shortLivedToken) throw new Error("Failed to get access token");

    // 2) Exchange for long-lived token
    const longLivedUrl =
      `https://graph.facebook.com/v16.0/oauth/access_token` +
      `?grant_type=fb_exchange_token&client_id=${META_APP_ID}` +
      `&client_secret=${META_APP_SECRET}` +
      `&fb_exchange_token=${encodeURIComponent(shortLivedToken)}`;

    const longRes = await axios.get(longLivedUrl);
    const longLivedToken = longRes.data?.access_token || shortLivedToken;
    const expiresIn = longRes.data?.expires_in || null;

    // 3) Query Graph to find WhatsApp Business Account(s)
    const fields = encodeURIComponent(
      "businesses{whatsapp_business_accounts{phone_numbers,id}}"
    );
    const whoUrl = `https://graph.facebook.com/v16.0/me?fields=${fields}&access_token=${encodeURIComponent(
      longLivedToken
    )}`;
    const whoRes = await axios.get(whoUrl);
    const businesses = whoRes.data?.businesses || [];

    let waAccountId = null;
    let phoneNumber = null;
    for (const b of businesses.data || businesses) {
      const wbas = b?.whatsapp_business_accounts || [];
      for (const w of wbas.data || wbas) {
        waAccountId = w.id || waAccountId;
        if (w.phone_numbers?.data?.length) {
          phoneNumber = w.phone_numbers.data[0]?.phone_number || phoneNumber;
        }
      }
    }

    // 4) Save to Firestore
    const integration = {
      access_token: longLivedToken,
      expires_in: expiresIn,
      whatsapp_business_account_id: waAccountId,
      phone_number: phoneNumber,
      linkedAt: new Date().toISOString(),
    };

    if (state) {
      await saveIntegration(state, integration);
      console.log("✅ Saved integration for uid=", state);
    } else {
      console.log("⚠️ No state provided; not saving to user doc.");
    }

    // 5) Redirect back to frontend
    return res.redirect(`${process.env.FRONTEND_URL || "/"}?connected=1`);
  } catch (err) {
    console.error(
      "⚠️ OAuth callback error:",
      err.response?.data || err.message || err
    );
    return res.status(500).send("OAuth error — check server logs");
  }
});

// ✅ NEW: test endpoint to view saved Meta token
app.get("/auth/token", async (req, res) => {
  try {
    const uid = req.query.uid;
    if (!uid) return res.status(400).json({ error: "Missing uid" });
    if (!firestore)
      return res
        .status(500)
        .json({ error: "Firestore not initialized on this server" });

    const ref = firestore
      .collection("users")
      .doc(uid)
      .collection("integrations")
      .doc("meta");
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: "No token found" });
    return res.json(snap.data());
  } catch (err) {
    console.error("❌ Error fetching token:", err);
    return res.status(500).json({ error: err.message });
  }
});

// --- Webhook verification ---
app.get("/webhook", (req, res) => {
  const verifyToken = process.env.META_VERIFY_TOKEN || "mujeeb_test";
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode && token) {
    if (mode === "subscribe" && token === verifyToken) {
      console.log("✅ Webhook verified successfully with Meta");
      return res.status(200).send(challenge);
    } else {
      return res.sendStatus(403);
    }
  }
  return res.sendStatus(400);
});

// --- Receive webhooks (messages) ---
app.post("/webhook", async (req, res) => {
  console.log("📩 Webhook received from Meta:", JSON.stringify(req.body, null, 2));
  res.sendStatus(200);
});

app.get("/status", (req, res) => {
  res.json({ ok: true, msg: "Mujeeb OAuth backend running" });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Mujeeb OAuth server listening on ${PORT}`);
});
// 🔹 Test Firestore connectivity
app.get("/test-firestore", async (req, res) => {
  try {
    if (!firestore) {
      return res.status(500).json({ success: false, message: "Firestore not initialized" });
    }

    const testRef = firestore.collection("_test").doc("connectivity-check");
    const testData = { timestamp: new Date().toISOString(), message: "Hello from Mujeeb backend!" };

    // Write test data
    await testRef.set(testData);

    // Read it back
    const doc = await testRef.get();

    if (!doc.exists) {
      throw new Error("Document not found after write");
    }

    return res.json({
      success: true,
      message: "✅ Firestore connection successful!",
      data: doc.data(),
    });
  } catch (err) {
    console.error("⚠️ Firestore test error:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
});
