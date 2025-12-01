// backend/src/middleware/auth.js

import admin from "firebase-admin";

// التحقق من توكن المستخدم القادم من الواجهة الأمامية
export default async function verifyFirebaseToken(req, res, next) {
  try {
    const token = req.query.token || req.headers.authorization?.split(" ")[1];

    if (!token) {
      return res.status(401).json({ error: "Missing token" });
    }

    const decoded = await admin.auth().verifyIdToken(token);
    req.user = decoded; // وضع بيانات المستخدم في الطلب

    next();
  } catch (err) {
    console.error("❌ Invalid Firebase token:", err);
    return res.status(401).json({ error: "Invalid token" });
  }
      }
