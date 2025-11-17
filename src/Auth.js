const express = require("express");
const router = express.Router();
require("dotenv").config();

const APP_ID = process.env.META_APP_ID; 
const REDIRECT_URI = "https://mujeeb-assistent.onrender.com/auth/callback";
const SCOPES = [
  "whatsapp_business_management",
  "whatsapp_business_messaging",
  "business_management",
].join(",");

// 👉 GET /auth/whatsapp
router.get("/whatsapp", (req, res) => {
  const oauthURL = `https://www.facebook.com/v20.0/dialog/oauth?client_id=${APP_ID}&redirect_uri=${encodeURIComponent(
    REDIRECT_URI
  )}&scope=${SCOPES}&response_type=code`;

  res.redirect(oauthURL);
});

// 👉 Callback
router.get("/callback", async (req, res) => {
  const code = req.query.code;

  if (!code) {
    return res.status(400).send("Missing code param");
  }

  res.send("⚡ WhatsApp connected successfully! You can close this page.");
});

module.exports = router;
