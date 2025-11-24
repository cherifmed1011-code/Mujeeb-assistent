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
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const META_VERIFY_TOKEN = process.env.META_VERIFY_TOKEN || "mujeeb_test";
const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const GROQ_API_KEY = process.env.GROQ_API_KEY;

// =========================
// الذكاء الاصطناعي باستخدام GROQ - نسخة مبسطة
// =========================
async function getAIResponse(userMessage, userPhone) {
  try {
    // إذا ما في API Key، استخدم رد افتراضي
    if (!GROQ_API_KEY) {
      console.log("🤖 استخدام الرد الافتراضي (لا يوجد GROQ_API_KEY)");
      return `مرحباً! شكراً على رسالتك: "${userMessage}". كيف يمكنني مساعدتك؟`;
    }

    console.log("🤖 جلب رد من الذكاء الاصطناعي...");
    
    const response = await axios.post(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        model: "llama-3.1-8b-instant",
        messages: [
          {
            role: "system",
            content: "أنت مساعد واتساب ذكي. رد باللغة العربية بطريقة ودودة ومفيدة."
          },
          {
            role: "user", 
            content: userMessage
          }
        ],
        max_tokens: 150,
        temperature: 0.7
      },
      {
        headers: {
          'Authorization': `Bearer ${GROQ_API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 10000
      }
    );

    const aiResponse = response.data.choices[0].message.content;
    console.log("🤖 رد الذكاء الاصطناعي:", aiResponse);
    return aiResponse;

  } catch (error) {
    console.error("❌ خطأ في الذكاء الاصطناعي:", error.message);
    
    // رد افتراضي في حالة الخطأ
    return `أهلاً بك! شكراً للتواصل معنا. 
    
رسالتك: "${userMessage}"
    
كيف يمكنني مساعدتك؟ 😊`;
  }
}

// =========================
// Health check
// =========================
app.get("/", (req, res) => {
  res.json({ 
    status: "Mujeeb backend running",
    features: {
      ai: !!GROQ_API_KEY,
      whatsapp: !!WHATSAPP_TOKEN
    }
  });
});

// =========================
// Webhook verify (Meta requirement)
// =========================
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === META_VERIFY_TOKEN) {
    console.log("✅ Webhook verified successfully!");
    return res.status(200).send(challenge);
  }

  console.log("❌ Webhook verification failed");
  res.sendStatus(403);
});

// =========================
// Webhook receiver - محدث مع الذكاء الاصطناعي
// =========================
app.post("/webhook", async (req, res) => {
  try {
    const body = req.body;

    // التحقق من أن الطلب من واتساب ويحتوي على رسائل
    if (
      body.object === "whatsapp_business_account" &&
      body.entry &&
      body.entry[0].changes &&
      body.entry[0].changes[0].value.messages &&
      body.entry[0].changes[0].value.messages[0]
    ) {
      const change = body.entry[0].changes[0].value;
      const message = change.messages[0];

      const from = message.from;
      const userMessage = message.text?.body || "";
      const messageType = message.type;

      console.log("📩 واردة:", userMessage);
      console.log("📞 من الرقم:", from);
      console.log("🔤 نوع الرسالة:", messageType);

      // التحقق من وجود جميع المتطلبات
      if (!WHATSAPP_PHONE_NUMBER_ID) {
        console.error("❌ WHATSAPP_PHONE_NUMBER_ID غير محدد في البيئة");
        return res.sendStatus(200);
      }

      if (!WHATSAPP_TOKEN) {
        console.error("❌ WHATSAPP_TOKEN غير محدد في البيئة");
        return res.sendStatus(200);
      }

      // إرسال الرد فقط إذا كانت الرسالة نصية
      if (messageType === "text") {
        
        // ✅ الحصول على رد ذكي من AI
        const aiResponse = await getAIResponse(userMessage, from);
        
        await axios.post(
          `https://graph.facebook.com/v19.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`,
          {
            messaging_product: "whatsapp",
            to: from,
            text: { 
              body: aiResponse
            },
          },
          {
            headers: {
              Authorization: `Bearer ${WHATSAPP_TOKEN}`,
              "Content-Type": "application/json",
            },
            timeout: 10000,
          }
        );

        console.log("🤖 تم إرسال الرد الذكي للمستخدم");
      }
    } else {
      console.log("ℹ️  استلام ويب هوك بدون رسالة نصية");
    }

    res.sendStatus(200);
  } catch (err) {
    console.error("❌ Webhook error:", err.message);
    res.sendStatus(200);
  }
});

// =========================
// Test endpoint لإرسال رسالة
// =========================
app.post("/test-send", async (req, res) => {
  try {
    const { to, message } = req.body;

    if (!to || !message) {
      return res.status(400).json({ 
        error: "المعطيات الناقصة: to و message مطلوبين" 
      });
    }

    const response = await axios.post(
      `https://graph.facebook.com/v19.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to: to,
        text: { body: message },
      },
      {
        headers: {
          Authorization: `Bearer ${WHATSAPP_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );

    console.log("✅ رسالة اختبار مرسلة:", response.data);
    res.json({ success: true, data: response.data });
  } catch (error) {
    console.error("❌ خطأ في إرسال رسالة الاختبار:", error.message);
    res.status(500).json({ 
      error: "فشل إرسال الرسالة",
      details: error.message 
    });
  }
});

// =========================
// Start server - النسخة المبسطة
// =========================
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Mujeeb server running on port ${PORT}`);
  console.log(`🔧 Config:`, {
    hasToken: !!WHATSAPP_TOKEN,
    hasPhoneNumberId: !!WHATSAPP_PHONE_NUMBER_ID,
    hasAI: !!GROQ_API_KEY,
    verifyToken: META_VERIFY_TOKEN
  });
});
