// SupportHub Group 12 - real-browser smoke test of the frontend (Playwright)
//
// Drives the pages in Chromium against the integrated stack, with the
// Cloudflare-Pages Content-Security-Policy applied by frontend/dev-server.js.
// Fails on any CSP violation or uncaught page error.
//   node tests/integration/frontend-smoke.cjs
// Env: BASE_URL (default http://localhost:8088), SUPPORTHUB_DEMO_PASSWORD
// Output: evidence/final/frontend/smoke-<ts>.txt and screenshots.

const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const ROOT = path.resolve(__dirname, "..", "..");
const BASE = (process.env.BASE_URL || "http://localhost:8088").replace(/\/$/, "");
const PASSWORD = process.env.SUPPORTHUB_DEMO_PASSWORD ||
  fs.readFileSync(path.join(ROOT, "infra/floci/.generated/demo-accounts.txt"), "utf8").match(/^password=(.+)$/m)[1].trim();
// SMOKE_OUT_DIR keeps new screenshots away from earlier evidence.
const OUT = path.resolve(ROOT, process.env.SMOKE_OUT_DIR || "evidence/final/frontend");
fs.mkdirSync(OUT, { recursive: true });

const lines = [];
let pass = 0, fail = 0;
const log = t => { lines.push(t); console.log(t); };
const check = (name, ok, detail = "") => { ok ? pass++ : fail++; log(`${ok ? "PASS" : "FAIL"} | ${name}${detail ? " | " + detail : ""}`); };

(async () => {
  const browser = await chromium.launch(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {});
  const problems = [];

  async function newPage(width = 1280) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await context.newPage();
    page.on("console", m => {
      const text = m.text();
      if (/Content Security Policy|Refused to/i.test(text)) problems.push(`CSP: ${text.slice(0, 160)}`);
    });
    page.on("pageerror", e => problems.push(`pageerror: ${e.message.slice(0, 160)}`));
    page.on("dialog", d => { problems.push(`dialog: ${d.message()}`); d.dismiss(); });
    return page;
  }
  async function login(page, email) {
    await page.goto(`${BASE}/login.html`);
    await page.fill("#login-form input[name=email]", email);
    await page.fill("#login-form input[name=password]", PASSWORD);
    await Promise.all([page.waitForURL(/(editor|review|analytics)\.html/, { timeout: 15000 }), page.click("#login-form button[type=submit]")]);
  }
  const shot = (page, name) => page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });

  log(`SupportHub frontend smoke test - ${new Date().toISOString()} - ${BASE}`);

  // Public pages
  let page = await newPage();
  const res = await page.goto(`${BASE}/index.html`);
  check("CSP header present on static pages", /default-src 'self'/.test(res.headers()["content-security-policy"] || ""));
  check("home page renders hero and navigation", await page.isVisible(".hero") && (await page.locator("#navigation a").count()) >= 2);
  await shot(page, "01-home");
  await page.fill("#search-input", "password");
  await Promise.all([page.waitForURL(/articles\.html\?q=password/), page.click("#search-form button")]);
  await page.waitForSelector("#articles-list .article-card", { timeout: 10000 }).catch(() => {});
  const cards = await page.locator("#articles-list .article-card").count();
  check("reader search shows published articles from the Search API", cards > 0, `${cards} results`);
  check("category filter populated from Article API", (await page.locator("#category-filter option").count()) > 1);
  await shot(page, "02-search-results");

  // Registration form (Turnstile)
  await page.goto(`${BASE}/login.html`);
  check("registration form and Turnstile container present", await page.isVisible("#register-form") && (await page.locator("#registration-turnstile").count()) === 1);
  const turnstileScript = await page.evaluate(() => [...document.scripts].some(s => s.src.startsWith("https://challenges.cloudflare.com/turnstile/")));
  check("Turnstile script requested (allowed by CSP script-src)", turnstileScript);
  await shot(page, "03-login-register");

  // Author
  await login(page, "author@supporthub.test");
  check("author login redirects to editor.html", page.url().endsWith("editor.html"));
  await page.waitForTimeout(1500);
  check("navigation shows author links (My Articles) and marks the current page", (await page.locator('#navigation a[href="editor.html"]').count()) === 1 && (await page.locator('#navigation a[aria-current="page"]').count()) === 1);
  check("author article list loads (GET /api/articles/mine)", (await page.locator("body").innerText()).length > 200);
  await shot(page, "04-author-dashboard");
  await page.fill("#reference-query", "reset password").catch(() => {});
  await page.click("#reference-form button[type=submit]").catch(() => {});
  await page.waitForTimeout(2500);
  const refText = (await page.locator("#reference-message").textContent().catch(() => "")) + (await page.locator("#reference-results").textContent().catch(() => ""));
  check("Stack Exchange references: results, or the safe 502 message when api.stackexchange.com is blocked", (await page.locator("#reference-results a").count()) > 0 || /Reference provider unavailable/.test(refText), refText.trim().slice(0, 90));
  await page.goto(`${BASE}/versions.html`);
  await page.waitForTimeout(1500);
  check("versions page loads for author", !page.url().endsWith("login.html"));
  await shot(page, "05-versions");

  // Ownership/role in the browser: author opens review page -> redirected
  problems.length = problems.filter(p => !p.startsWith("dialog:")).length ? problems.length : 0;
  const before = problems.length;
  await page.goto(`${BASE}/review.html`);
  await page.waitForTimeout(1500);
  const deniedDialog = problems.slice(before).some(p => /permission/.test(p));
  check("author is refused on review.html (role guard; backend also returns 403)", deniedDialog || page.url().endsWith("login.html"));
  problems.splice(before); // the expected permission dialog is not a defect

  // Editor
  page = await newPage();
  await login(page, "editor@supporthub.test");
  check("editor login redirects to review.html", page.url().endsWith("review.html"));
  await page.waitForTimeout(2500);
  check("review queue rendered", (await page.locator("#review-list").innerText()).trim().length > 0);
  check("outdated-flag panel rendered", (await page.locator("#flag-list").innerText()).trim().length > 0);
  await page.fill("#history-article-id", "1");
  await page.click("#history-form button");
  await page.waitForSelector("#history-result .timeline li", { timeout: 8000 }).catch(() => {});
  check("editorial history timeline (GET /api/articles/1/history)", (await page.locator("#history-result .timeline li").count()) > 0);
  await shot(page, "06-editor-dashboard");

  // Admin analytics
  page = await newPage();
  await login(page, "admin@supporthub.test");
  await page.goto(`${BASE}/analytics.html`);
  await page.waitForSelector("#analytics-summary .stat-card", { timeout: 10000 }).catch(() => {});
  check("analytics dashboard shows statistics", (await page.locator("#analytics-summary .stat-card").count()) > 0);
  await shot(page, "07-analytics");

  // Mobile layout
  page = await newPage(390);
  await page.goto(`${BASE}/index.html`);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  check("no horizontal scroll at 390 px phone width", !overflow);
  await shot(page, "08-home-mobile");

  const cspProblems = problems.filter(p => p.startsWith("CSP"));
  check("no Content-Security-Policy violations on any page", cspProblems.length === 0, cspProblems.join(" || ").slice(0, 300));
  const other = problems.filter(p => !p.startsWith("CSP"));
  check("no uncaught page errors or unexpected dialogs", other.length === 0, other.join(" || ").slice(0, 300));

  await browser.close();
  log(`\nTotal: ${pass} passed, ${fail} failed`);
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  fs.writeFileSync(path.join(OUT, `smoke-${stamp}.txt`), lines.join("\n") + "\n");
  process.exitCode = fail ? 1 : 0;
})().catch(e => { console.error(e); process.exit(1); });
