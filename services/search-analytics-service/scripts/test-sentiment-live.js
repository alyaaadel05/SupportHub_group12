// Live Hugging Face sentiment check. Reads HF_INFERENCE_URL / HF_TOKEN from .env.
// The token is never printed.
require("dotenv").config();
const { classify } = require("../services/sentimentService");

(async () => {
  console.log("Hugging Face sentiment live test —", new Date().toISOString());
  console.log("Model:", process.env.HF_INFERENCE_URL || "(not set)");

  const positive = await classify("Very clear article, it fixed my problem. Thank you!");
  console.log("1. Positive feedback :", JSON.stringify(positive));

  const negative = await classify("This is confusing and did not help at all.");
  console.log("2. Negative feedback :", JSON.stringify(negative));

  const savedToken = process.env.HF_TOKEN;
  delete process.env.HF_TOKEN;
  const off = await classify("Any text");
  process.env.HF_TOKEN = savedToken;
  console.log("3. No token (safe)   :", JSON.stringify(off));
})();