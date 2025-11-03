import express from "express";
import dotenv from "dotenv";
import bodyParser from "body-parser";
import axios from "axios";
import twilio from "twilio";
import cors from "cors";

dotenv.config();

const app = express();
app.use(cors());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

const PORT = process.env.PORT || 10000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;

const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

// ✅ اختبار جاهزية السيرفر
app.get("/", (req, res) => {
  res.json({ status: "✅ Mujeeb backend is running with Gemini!" });
});

// ✅ استقبال رسائل واتساب من Twilio
app.post("/twilio/whatsapp/webhook", async (req, res) => {
  try {
    console.log("📩 Webhook data:", req.body);

    const messageBody = req.body.Body;
    const from = req.body.From;

    if (!messageBody || !from) {
      console.error("⚠️ خطأ: لم يتم استلام Body أو From من Twilio!");
      return res.sendStatus(400);
    }

    console.log("📨 رسالة جديدة من:", from, "المحتوى:", messageBody);

    // 🔹 اختبار سريع
    if (messageBody.toLowerCase().includes("test")) {
      await client.messages.create({
        from: "whatsapp:+14155238886",
        to: from,
        body: "✅ تم استلام رسالتك، السيرفر يعمل بنجاح!",
      });
      return res.sendStatus(200);
    }

    // 🔹 طلب Gemini API
    const geminiResponse = await axios.post(
      `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        contents: [
          {
            parts: [{ text: `رد على المستخدم بطريقة لبقة وواضحة: ${messageBody}` }],
          },
        ],
      },
      { headers: { "Content-Type": "application/json" } }
    );

    const reply =
      geminiResponse.data?.candidates?.[0]?.content?.parts?.[0]?.text ||
      "عذرًا، لم أستطع فهم رسالتك.";

    // 🔹 إرسال الرد إلى واتساب
    await client.messages.create({
      from: "whatsapp:+14155238886",
      to: from,
      body: reply,
    });

    console.log("✅ تم إرسال الرد:", reply);
    res.sendStatus(200);
  } catch (error) {
    console.error("❌ خطأ في معالجة الرسالة:", error.response?.data || error.message);
    res.sendStatus(500);
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Mujeeb server is running on port ${PORT}`);
});
