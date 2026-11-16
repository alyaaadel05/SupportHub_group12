const { HttpError } = require("../services/http");
async function verifyTurnstile(token, ip) {
  if (typeof token !== "string" || !token.trim()) throw new HttpError(403, "Turnstile token required");
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) throw new HttpError(503, "Turnstile not configured");
  const form = new URLSearchParams({ secret, response: token });
  if (ip) form.set("remoteip", ip);
  let response;
  try {
    response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST", body: form, signal: AbortSignal.timeout(7000)
    });
  } catch { throw new HttpError(502, "Turnstile verification unavailable"); }
  if (!response.ok) throw new HttpError(502, "Turnstile verification unavailable");
  const data = await response.json();
  if (!data.success) throw new HttpError(403, "Turnstile verification failed");
  return true;
}
module.exports = { verifyTurnstile };
