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
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;

const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

app.get("/", (req, res) => {
  res.json({ status: "✅ Mujeeb backend is running with GROQ AI!" });
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

    // 🔹 رد اختبار
    if (messageBody.toLowerCase().includes("test")) {
      await client.messages.create({
        from: "whatsapp:+14155238886",
        to: from,
        body: "✅ تم استلام رسالتك! السيرفر يعمل بنجاح (GROQ).",
      });
      return res.sendStatus(200);
    }

    // 🔹 معالجة الطلب بواسطة GROQ API
    const groqResponse = await axios.post(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        model: "llama3-70b-8192", // يمكنك تغييره إلى llama3-70b إذا أردت أداء أقوى
        messages: [
          {
            role: "system",
            content:
              "أنت مساعد ذكي اسمه (مجيب) تتحدث العربية بطلاقة وتساعد المستخدمين بطريقة مفيدة وودودة.",
          },
          { role: "user", content: messageBody },
        ],
      },
      {
        headers: {
          "Authorization": `Bearer ${GROQ_API_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    const reply =
      groqResponse.data?.choices?.[0]?.message?.content ||
      "عذرًا، لم أستطع فهم رسالتك.";

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
        body: "⚠️ حدث خطأ في النظام. الرجاء المحاولة لاحقًا.",
      });
    } catch (twilioError) {
      console.error("❌ فشل إرسال رسالة الخطأ:", twilioError);
    }

    res.sendStatus(500);
  }
});

app.listen(PORT, "0.0.0.0", () =>
  console.log(`🚀 Mujeeb server is running on port ${PORT}`)
);
