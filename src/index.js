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

if (!GROQ_API_KEY || !TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
  console.error("❌ خطأ: متغيرات البيئة مفقودة (GROQ_API_KEY / TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN).");
  process.exit(1);
}

const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

function sanitizeReply(text) {
  if (!text) return "";
  // إزالة مسافات زائدة وأسطر جديدة
  let r = text.toString().trim().replace(/\s+/g, " ");
  // إزالة علامات اقتباس أو تحويرات غير مرغوبة في البداية/النهاية
  r = r.replace(/^["'`]+|["'`]+$/g, "").trim();
  return r;
}

function isBadReply(r) {
  if (!r) return true;
  const short = r.replace(/[^\p{L}\p{N}]/gu, "").toLowerCase();
  // كلمات قصيرة/غير مفيدة نرفضها
  const bad = ["ok", "okay", "تمام", "حسنا", "حسناً", "جيب", "yes", "no"];
  if (short.length <= 2) return true;
  if (bad.includes(short)) return true;
  return false;
}

app.get("/", (req, res) => {
  res.json({ status: "✅ Mujeeb backend is running (GROQ)!" });
});

app.post("/twilio/whatsapp/webhook", async (req, res) => {
  try {
    console.log("📩 Webhook data:", req.body);
    const messageBody = (req.body.Body || req.body.body || "").toString();
    const from = req.body.From || req.body.from;

    if (!messageBody || !from) {
      console.error("⚠️ لم يصل Body أو From من Twilio");
      return res.sendStatus(400);
    }

    console.log("📨 رسالة جديدة من:", from, "المحتوى:", messageBody);

    // رد اختبار سريع (لن يرسل "OK")
    if (messageBody.trim().toLowerCase().includes("test")) {
      await client.messages.create({
        from: "whatsapp:+14155238886",
        to: from,
        body: "✅ تم استلام رسالتك، السيرفر يعمل بنجاح!",
      });
      return res.sendStatus(200);
    }

    // إعداد الـ system prompt باللغة العربية بشكل واضح
    const systemPrompt = [
      {
        role: "system",
        content:
أنت "مجيب" — مساعد ذكي موريتاني محترم.
تتحدث العربية الفصحى البسيطة فقط.
تكون مختصرًا وواضحًا وترد فقط على حسب السؤال بدون أي إضافات زائدة.
ممنوع تمامًا استخدام كلمة "ok" أو "OK" أو أي ترجمة لها مثل "حسنًا" أو "تمام" في أي رد.
إذا كان السؤال خارج النطاق أو غير مفهوم، قل بأدب أنك لم تفهم.

      },
      { role: "user", content: messageBody }
    ];

    // استدعاء GROQ / OpenAI-compatible endpoint
    const groqResp = await axios.post(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        model: "llama-3.1-8b-instant", // غيّر إذا تحتاج نموذج آخر متاح في حسابك
        messages: systemPrompt,
        max_tokens: 512,
        temperature: 0.2
      },
      {
        headers: {
          Authorization: `Bearer ${GROQ_API_KEY}`,
          "Content-Type": "application/json"
        },
        timeout: 30000
      }
    );

    // استخراج النص من استجابة الـ API (تأكد من شكل استجابة Groq لديك)
    const aiContent =
      groqResp.data?.choices?.[0]?.message?.content ||
      groqResp.data?.choices?.[0]?.text ||
      "";

    let reply = sanitizeReply(aiContent);
    if (isBadReply(reply)) {
      console.warn("⚠️ الرد غير مقبول من AI أو قصير جداً، سيتم استخدام رد احتياطي.");
      reply = "عذرًا، لم أتمكن من توليد رد مناسب الآن. هل يمكنك إعادة صياغة السؤال؟";
    }

    // إرسال الرد عبر Twilio
    await client.messages.create({
      from: "whatsapp:+14155238886",
      to: from,
      body: reply.substring(0, 1600)
    });

    console.log("✅ تم إرسال الرد:", reply);
    return res.sendStatus(200);
  } catch (err) {
    console.error("❌ خطأ في المعالجة:", err.response?.data || err.message || err);
    // إرسال رسالة عامة للمستخدم إن أمكن
    try {
      if (req.body?.From) {
        await client.messages.create({
          from: "whatsapp:+14155238886",
          to: req.body.From,
          body: "⚠️ عذرًا، واجهنا مشكلة تقنية مؤقتة. الرجاء المحاولة لاحقًا."
        });
      }
    } catch (twErr) {
      console.error("❌ خطأ أثناء محاولة إرسال رسالة الخطأ:", twErr);
    }
    return res.sendStatus(500);
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Mujeeb server is running on port ${PORT}`);
});
