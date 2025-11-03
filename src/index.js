import express from "express";
import dotenv from "dotenv";
import bodyParser from "body-parser";
import axios from "axios";
import twilio from "twilio";
import cors from "cors";

dotenv.config();

// Basic env check
const { GEMINI_API_KEY, TWILIO_AUTH_TOKEN, TWILIO_ACCOUNT_SID } = process.env;
if (!GEMINI_API_KEY || !TWILIO_AUTH_TOKEN || !TWILIO_ACCOUNT_SID) {
  console.error("❌ خطأ: تأكد من وجود المتغيرات البيئة: GEMINI_API_KEY, TWILIO_AUTH_TOKEN, TWILIO_ACCOUNT_SID");
  process.exit(1);
}

const app = express();
app.use(cors());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

const PORT = process.env.PORT || 10000;
const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

// helper: call ListModels to know available models
async function listGeminiModels() {
  try {
    const url = `https://generativelanguage.googleapis.com/v1/models?key=${GEMINI_API_KEY}`;
    const resp = await axios.get(url, { timeout: 15000 });
    return resp.data?.models || [];
  } catch (err) {
    console.error("⚠️ فشل في استدعاء ListModels:", err.response?.data || err.message);
    return [];
  }
}

// helper: try a single endpoint (fullUrl) with payload
async function tryCallGeminiEndpoint(fullUrl, payload) {
  try {
    const resp = await axios.post(fullUrl, payload, {
      headers: { "Content-Type": "application/json" },
      timeout: 30000,
    });
    return { ok: true, data: resp.data };
  } catch (err) {
    // return detailed info but don't throw — the caller will decide next step
    return { ok: false, error: err.response?.data || err.message, status: err.response?.status };
  }
}

// choose a model from list (preference for gemini/flash/pro)
function pickModel(models) {
  if (!Array.isArray(models) || models.length === 0) return null;
  // prefer gemini-.. flash or pro
  const pref = models.map(m => m.name || m.model || m).filter(Boolean);
  const candidates = [...pref];
  // ranking
  for (const key of ["gemini", "flash", "pro"]) {
    const found = candidates.find(m => m.toLowerCase().includes(key));
    if (found) return found;
  }
  // fallback to first model name
  return candidates[0];
}

app.get("/", (req, res) => {
  res.json({ status: "✅ Mujeeb backend is running with Gemini (robust mode)!" });
});

app.post("/twilio/whatsapp/webhook", async (req, res) => {
  try {
    console.log("📩 Webhook data:", req.body);

    const messageBody = req.body.Body;
    const from = req.body.From;

    if (!messageBody || !from) {
      console.error("⚠️ Missing Body or From in Twilio payload", req.body);
      return res.sendStatus(400);
    }

    console.log("📨 رسالة جديدة من:", from, "المحتوى:", messageBody);

    // quick test response
    if (messageBody.toLowerCase().includes("test")) {
      await client.messages.create({
        from: "whatsapp:+14155238886",
        to: from,
        body: "✅ تم استلام رسالتك، السيرفر يعمل بنجاح!",
      });
      return res.sendStatus(200);
    }

    // Build prompt
    const prompt = `أنت مساعد ذكي يتحدث العربية. 
المستخدم يقول: "${messageBody}"
اكتب ردًا مختصرًا وودودًا ومفيدًا باللغة العربية (وجه رسالة قصيرة مناسبة للواتساب).`;

    // 1) get models list
    const models = await listGeminiModels();
    const chosenModel = pickModel(models);
    console.log("ℹ️ نماذج متاحة (بعضها):", models.slice(0,5).map(m => m.name || m).join(", "));
    console.log("ℹ️ النموذج المختار للاختبار:", chosenModel);

    // prepare payload in a generic compatible shape for generateContent/generateText
    const contentsPayload = {
      contents: [{ parts: [{ text: prompt }] }],
    };

    // Candidate endpoints to try (in order). we will substitute {model}
    const endpointsToTry = [];

    if (chosenModel) {
      // try v1beta generateContent with -latest suffix (some accounts use v1beta)
      endpointsToTry.push(`https://generativelanguage.googleapis.com/v1beta/models/${chosenModel}:generateContent?key=${GEMINI_API_KEY}`);
      // try v1beta with -latest if chosenModel doesn't include -latest
      if (!chosenModel.includes("-latest")) {
        endpointsToTry.push(`https://generativelanguage.googleapis.com/v1beta/models/${chosenModel}-latest:generateContent?key=${GEMINI_API_KEY}`);
      }
      // try v1 generateText (some models use generateText)
      endpointsToTry.push(`https://generativelanguage.googleapis.com/v1/models/${chosenModel}:generateText?key=${GEMINI_API_KEY}`);
      // try v1 generateContent as a fallback
      endpointsToTry.push(`https://generativelanguage.googleapis.com/v1/models/${chosenModel}:generateContent?key=${GEMINI_API_KEY}`);
    }

    // Generic fallback endpoints (try some common model ids if above didn't work)
    const fallbackModelIds = ["gemini-1.5-chat", "gemini-1.5-pro", "gemini-1.5", "chat-bison", "text-bison"];
    for (const mid of fallbackModelIds) {
      endpointsToTry.push(`https://generativelanguage.googleapis.com/v1/models/${mid}:generateText?key=${GEMINI_API_KEY}`);
      endpointsToTry.push(`https://generativelanguage.googleapis.com/v1beta/models/${mid}:generateContent?key=${GEMINI_API_KEY}`);
      endpointsToTry.push(`https://generativelanguage.googleapis.com/v1/models/${mid}:generateContent?key=${GEMINI_API_KEY}`);
    }

    // Try endpoints one by one until one succeeds
    let geminiResult = null;
    let lastError = null;
    for (const url of endpointsToTry) {
      console.log("🔁 Trying Gemini endpoint:", url);
      const result = await tryCallGeminiEndpoint(url, contentsPayload);
      if (result.ok && result.data) {
        geminiResult = result.data;
        console.log("✅ Gemini endpoint succeeded:", url);
        break;
      } else {
        lastError = result.error;
        console.warn("⚠️ Endpoint failed:", url, "status:", result.status, "error:", result.error);
      }
    }

    if (!geminiResult) {
      console.error("❌ جميع محاولات استدعاء Gemini فشلت. آخر خطأ:", lastError);
      // send user-friendly message to the user
      try {
        await client.messages.create({
          from: "whatsapp:+14155238886",
          to: from,
          body: "⚠️ عذراً، حدث خطأ مؤقت في خدمة الردود الآلية. سنحاول لاحقًا. شكراً لصبرك.",
        });
      } catch (twErr) {
        console.error("❌ فشل إرسال رسالة الخطأ عبر Twilio:", twErr);
      }
      return res.sendStatus(500);
    }

    // Extract text reply from possible response shapes
    let replyText = null;

    // Common shape: { candidates: [ { content: { parts: [ { text } ] } } ] }
    replyText = geminiResult?.candidates?.[0]?.content?.parts?.[0]?.text;

    // Some models return text in `.output_text` or `.generations`
    if (!replyText) {
      replyText = geminiResult?.output_text || geminiResult?.generations?.[0]?.text || null;
    }

    // If still not found, try to stringify a reasonable fallback
    if (!replyText) {
      replyText = JSON.stringify(geminiResult).slice(0, 1200); // safety: limit length
    }

    // Send reply via Twilio
    await client.messages.create({
      from: "whatsapp:+14155238886",
      to: from,
      body: replyText.substring(0, 1600),
    });

    console.log("✅ تم إرسال الرد إلى:", from, "الرد:", replyText.substring(0, 200));
    return res.sendStatus(200);

  } catch (error) {
    console.error("❌ خطأ عام في Webhook:", error.response?.data || error.message || error);
    // try to notify user (best-effort)
    try {
      if (req.body?.From) {
        await client.messages.create({
          from: "whatsapp:+14155238886",
          to: req.body.From,
          body: "⚠️ عذراً، حدث خطأ تقني. سنعاود المحاولة لاحقًا.",
        });
      }
    } catch (twErr) {
      console.error("❌ فشل إرسال رسالة الخطأ للمستخدم:", twErr);
    }
    return res.sendStatus(500);
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Mujeeb server is running on port ${PORT}`);
});
