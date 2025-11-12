import admin from "firebase-admin";
import fs from "fs";

// نحاول أولاً قراءة المفتاح من متغير البيئة (Render)
let serviceAccount;

if (process.env.FIREBASE_KEY) {
  // على Render
  serviceAccount = JSON.parse(process.env.FIREBASE_KEY);
} else if (fs.existsSync("./src/firebase-key.json")) {
  // على جهازك المحلي
  serviceAccount = JSON.parse(fs.readFileSync("./src/firebase-key.json", "utf8"));
} else {
  console.error("❌ لم يتم العثور على مفتاح Firebase (لا في المتغير ولا في الملف)");
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

export default admin;
