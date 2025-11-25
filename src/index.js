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
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const META_VERIFY_TOKEN = process.env.META_VERIFY_TOKEN || "mujeeb_test";
const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const GROQ_API_KEY = process.env.GROQ_API_KEY;

// =========================
// Firebase Init (خطوة 1 و 2 تعتمد عليه)
// =========================
let firestore = null;

if (
  process.env.FIREBASE_PROJECT_ID &&
  process.env.FIREBASE_CLIENT_EMAIL &&
  process.env.FIREBASE_PRIVATE_KEY
) {
  try {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
      }),
    });

    firestore = admin.firestore();
    console.log("🔥 Firestore initialized!");
  } catch (err) {
    console.error("❌ Firebase init error:", err);
  }
} else {
  console.log("⚠️ Firestore not configured (messages will not be saved)");
}

// =========================
// AI (بدون تعديل)
// =========================
async function getAIResponse(userMessage, userPhone) {
  try {
    if (!GROQ_API_KEY) {
      return `مرحباً! شكراً على رسالتك: "${userMessage}". كيف يمكنني مساعدتك؟`;
    }

    const response = await axios.post(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        model: "llama-3.1-8b-instant",
        messages: [
          {
            role: "system",
            content: "أنت مساعد واتساب ذكي. رد باللغة العربية بطريقة ودودة."
          },
          { role: "user", content: userMessage }
        ],
        max_tokens: 150,
        temperature: 0.7
      },
      {
        headers: {
          Authorization: `Bearer ${GROQ_API_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    return response.data.choices[0].message.content;

  } catch (error) {
    return `أهلاً! رسالتك: "${userMessage}" — كيف يمكنني مساعدتك؟`;
  }
}

// =========================
// Webhook verify
// =========================
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === META_VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }

  res.sendStatus(403);
});

// =========================
// Webhook receiver (مضاف خطوة 1 و 2)
// =========================
app.post("/webhook", async (req, res) => {
  try {
    const body = req.body;

    if (
      body.object === "whatsapp_business_account" &&
      body.entry &&
      body.entry[0].changes &&
      body.entry[0].changes[0].value.messages &&
      body.entry[0].changes[0].value.messages[0]
    ) {
      const change = body.entry[0].changes[0].value;
      const message = change.messages[0];

      const from = message.from;          // رقم المستخدم (نستخدمه كـ userId)
      const userMessage = message.text?.body || "";
      const messageType = message.type;

      console.log("📩 واردة:", userMessage);
      console.log("📞 من:", from);

      // =========================
      // (1) تعيين userId = رقم الهاتف
      // =========================
      const userId = from;

      // =========================
      // (2) حفظ المحادثة في Firestore
      // =========================
      if (firestore) {
        await firestore.collection("messages").add({
          userId,
          from: "user",
          message: userMessage,
          timestamp: new Date().toISOString()
        });

        console.log("💾 تم حفظ الرسالة في Firestore");
      }

      // الرد فقط على الرسائل النصية
      if (messageType === "text") {
        const aiResponse = await getAIResponse(userMessage, from);

        // حفظ رد الذكاء الاصطناعي
        if (firestore) {
          await firestore.collection("messages").add({
            userId,
            from: "bot",
            message: aiResponse,
            timestamp: new Date().toISOString()
          });
        }

        // إرسال الرد
        await axios.post(
          `https://graph.facebook.com/v19.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`,
          {
            messaging_product: "whatsapp",
            to: from,
            text: { body: aiResponse },
          },
          {
            headers: {
              Authorization: `Bearer ${WHATSAPP_TOKEN}`,
              "Content-Type": "application/json",
            },
          }
        );

        console.log("🤖 تم إرسال الرد الذكي");
      }
    } else {
      console.log("ℹ️ Webhook بدون رسالة نصية");
    }

    res.sendStatus(200);
  } catch (err) {
    console.error("❌ Webhook error:", err.message);
    res.sendStatus(200);
  }
});

// =========================
// Start server
// =========================
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Mujeeb server running on port ${PORT}`);
});
