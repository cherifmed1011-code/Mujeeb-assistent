import express from "express";
import bodyParser from "body-parser";
import twilio from "twilio";
import fetch from "node-fetch";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

// بيانات البيئة
const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
const GROQ_API_KEY = process.env.GROQ_API_KEY;

// 🧠 تعريف شخصية مجيب
const SYSTEM_PROMPT = `
أنت "مجيب" — مساعد ذكي موريتاني محترم.
تتحدث العربية الفصحى البسيطة.
تكون مختصرًا وواضحًا وترد فقط على حسب السؤال بدون أي إضافات زائدة.
إذا كان السؤال خارج النطاق أو غير مفهوم، قل بأدب أنك لم تفهم.
`;

// 🎯 دالة للتحدث مع GROQ API
async function askGroq(message) {
  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${GROQ_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "llama-3.1-70b-versatile",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: message }
        ]
      })
    });

    const data = await response.json();

    if (data.choices && data.choices[0]?.message?.content) {
      return data.choices[0].message.content.trim();
    } else {
      console.error("❌ خطأ من GROQ:", data);
      return "عذرًا، حدث خلل مؤقت في النظام.";
    }
  } catch (error) {
    console.error("❌ فشل الاتصال بـ GROQ:", error);
    return "عذرًا، لم أستطع معالجة الطلب حاليًا.";
  }
}

// 📨 استقبال رسائل واتساب
app.post("/webhook", async (req, res) => {
  const from = req.body.From;
  const body = req.body.Body;

  console.log("📩 رسالة جديدة من:", from, "المحتوى:", body);

  const reply = await askGroq(body);
  console.log("✅ تم إرسال الرد:", reply);

  await twilioClient.messages.create({
    from: "whatsapp:+14155238886",
    to: from,
    body: reply
  });

  res.sendStatus(200);
});

// 🚀 تشغيل السيرفر
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Mujeeb server is running on port ${PORT}`));
