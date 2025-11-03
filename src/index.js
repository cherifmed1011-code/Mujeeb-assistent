import express from "express";
import dotenv from "dotenv";
import bodyParser from "body-parser";
import axios from "axios";
import twilio from "twilio";
import cors from "cors";

dotenv.config();

// التحقق من متغيرات البيئة
if (!process.env.GEMINI_API_KEY || !process.env.TWILIO_AUTH_TOKEN || !process.env.TWILIO_ACCOUNT_SID) {
  console.error("❌ خطأ: متغيرات البيئة مفقودة!");
  process.exit(1);
}

const app = express();
app.use(cors());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

const PORT = process.env.PORT || 10000;
const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

app.get("/", (req, res) => {
  res.json({ status: "✅ Mujeeb backend is running with Gemini!" });
});

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

    // رد الاختبار
    if (messageBody.toLowerCase().includes("test")) {
      await client.messages.create({
        from: "whatsapp:+14155238886",
        to: from,
        body: "✅ تم استلام رسالتك، السيرفر يعمل بنجاح!",
      });
      return res.sendStatus(200);
    }

    // طلب Gemini API
    const prompt = `أنت مساعد ذكي يتحدث العربية. 
المستخدم يقول: "${messageBody}"
رد بطريقة مفيدة وودودة ومناسبة للغة العربية.`;

    const geminiResponse = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        contents: [
          {
            parts: [{ text: prompt }],
          },
        ],
      },
      { 
        headers: { "Content-Type": "application/json" },
        timeout: 30000 // 30 ثانية timeout
      }
    );

    const reply =
      geminiResponse.data?.candidates?.[0]?.content?.parts?.[0]?.text ||
      "عذرًا، لم أستطع فهم رسالتك. الرجاء المحاولة مرة أخرى.";

    // إرسال الرد
    await client.messages.create({
      from: "whatsapp:+14155238886",
      to: from,
      body: reply.substring(0, 1600), // تقليل النص إذا كان طويلاً
    });

    console.log("✅ تم إرسال الرد بنجاح");
    res.sendStatus(200);

  } catch (error) {
    console.error("❌ خطأ في معالجة الرسالة:", error);
    
    // إرسال رسالة خطأ للمستخدم
    try {
      await client.messages.create({
        from: "whatsapp:+14155238886", 
        to: req.body.From,
        body: "⚠️ عذرًا، حدث خطأ في النظام. الرجاء المحاولة لاحقًا.",
      });
    } catch (twilioError) {
      console.error("❌ فشل إرسال رسالة الخطأ:", twilioError);
    }
    
    res.sendStatus(500);
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Mujeeb server is running on port ${PORT}`);
});
