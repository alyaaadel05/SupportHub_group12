// Live Turnstile check against Cloudflare using Cloudflare's official PUBLIC test keys.
// https://developers.cloudflare.com/turnstile/troubleshooting/testing/
// These test keys are not secrets. Real keys stay only in .env / the hosting dashboard.
const { verifyTurnstile } = require("../middleware/turnstile");

const ALWAYS_PASS = "1x0000000000000000000000000000000AA";
const ALWAYS_FAIL = "2x0000000000000000000000000000000AA";
const ALREADY_SPENT = "3x0000000000000000000000000000000AA";
const DUMMY_TOKEN = "XXXX.DUMMY.TOKEN.XXXX";

async function check(name, secret, token) {
  if (secret === null) delete process.env.TURNSTILE_SECRET_KEY;
  else process.env.TURNSTILE_SECRET_KEY = secret;
  try {
    await verifyTurnstile(token, "127.0.0.1");
    console.log(`${name}: ACCEPTED`);
  } catch (error) {
    console.log(`${name}: ${error.status} ${error.message}`);
  }
}

(async () => {
  console.log("Turnstile live test —", new Date().toISOString());
  await check("1. No token sent         ", ALWAYS_PASS, "");
  await check("2. No secret configured  ", null, DUMMY_TOKEN);
  await check("3. Always-pass test key  ", ALWAYS_PASS, DUMMY_TOKEN);
  await check("4. Always-fail test key  ", ALWAYS_FAIL, DUMMY_TOKEN);
  await check("5. Reused (spent) token  ", ALREADY_SPENT, DUMMY_TOKEN);
})();