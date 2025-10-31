import express from "express";
import bodyParser from "body-parser";
import axios from "axios";
import dotenv from "dotenv";
import cors from "cors";
import twilio from "twilio";

dotenv.config();

const app = express();
const port = process.env.PORT || 5000;

app.use(cors());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

// إعداد Twilio
const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

// استقبال الرسائل من واتساب
app.post("/webhook", async (req, res) => {
  const messageBody = req.body.Body?.trim();
  const from = req.body.From;

  console.log("📩 رسالة جديدة من:", from, "المحتوى:", messageBody);

  let reply = "👋 أهلاً! أنا مساعد مجيب الذكي. كيف يمكنني مساعدتك اليوم؟";

  if (messageBody?.toLowerCase().includes("مرحبا")) {
    reply = "أهلاً وسهلاً! كيف حالك اليوم؟ 😊";
  } else if (messageBody?.toLowerCase().includes("اسمك")) {
    reply = "اسمي مجيب 🤖، مساعد ذكي من شركة M.M.S!";
  }

  try {
    await client.messages.create({
      from: "whatsapp:+14155238886", // رقم Twilio Sandbox
      to: from,
      body: reply,
    });

    console.log("✅ تم إرسال الرد إلى:", from);
  } catch (error) {
    console.error("❌ خطأ في إرسال الرد:", error);
  }

  res.sendStatus(200);
});

app.get("/", (req, res) => {
  res.send("🚀 Mujeeb backend is running successfully!");
});

app.listen(port, () => console.log(`✅ Server running on port ${port}`));
