import express from "express";
import dotenv from "dotenv";
import bodyParser from "body-parser";
import axios from "axios";
import twilio from "twilio";
import cors from "cors";

dotenv.config();

if (!process.env.OPENAI_API_KEY || !process.env.TWILIO_AUTH_TOKEN || !process.env.TWILIO_ACCOUNT_SID) {
  console.error("❌ خطأ: متغيرات البيئة ناقصة!");
  process.exit(1);
}

const app = express();
app.use(cors());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

const PORT = process.env.PORT || 10000;
const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

// ✅ اختبار السيرفر
app.get("/", (req, res) => {
  res.json({ status: "✅ Mujeeb backend يعمل الآن باستخدام OpenAI GPT-4o-mini!" });
});

// ✅ استقبال رسائل واتساب من Twilio
app.post("/twilio/whatsapp/webhook", async (req, res) => {
  try {
    const { Body: messageBody, From: from } = req.body;
    if (!messageBody || !from) return res.sendStatus(400);

    console.log("📨 رسالة جديدة من:", from, "المحتوى:", messageBody);

    // 🔹 اختبار سريع
    if (messageBody.toLowerCase().includes("test")) {
      await client.messages.create({
        from: "whatsapp:+14155238886",
        to: from,
        body: "✅ تم استلام رسالتك، السيرفر متصل بنجاح مع OpenAI!",
      });
      return res.sendStatus(200);
    }

    // 🔹 إنشاء رد من نموذج OpenAI
    const prompt = `أنت مساعد ذكي تتحدث العربية الفصحى.
المستخدم قال: "${messageBody}"
أجب بشكل مهذب، مختصر وواضح.`;

    const openaiResponse = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
      },
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        },
        timeout: 30000, // مهلة 30 ثانية
      }
    );

    const reply =
      openaiResponse.data?.choices?.[0]?.message?.content ||
      "عذرًا، لم أستطع معالجة رسالتك.";

    // 🔹 إرسال الرد عبر Twilio
    await client.messages.create({
      from: "whatsapp:+14155238886",
      to: from,
      body: reply.substring(0, 1600),
    });

    console.log("✅ تم إرسال الرد:", reply);
    res.sendStatus(200);
  } catch (error) {
    console.error("❌ خطأ في المعالجة:", error.response?.data || error.message);

    try {
      await client.messages.create({
        from: "whatsapp:+14155238886",
        to: req.body.From,
        body: "⚠️ حدث خطأ مؤقت في النظام. الرجاء المحاولة لاحقًا.",
      });
    } catch (e) {
      console.error("❌ فشل إرسال رسالة الخطأ:", e.message);
    }

    res.sendStatus(500);
  }
});

// ✅ تشغيل السيرفر
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Mujeeb server يعمل على المنفذ ${PORT}`);
});
