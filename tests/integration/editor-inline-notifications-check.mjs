// SupportHub Group 12 - My Articles inline submission notices (ISOLATED stack only).
//
// The isolated frontend container (http://localhost:8188) bind-mounts another worktree's frontend/.
// To test THIS worktree without touching any container, the browser intercepts only
// editor.html and js/editorial.js and answers them with this worktree's files, keeping the
// server's real response headers (CSP etc.). Same origin, same APIs, same backend checks.
//
//   PW_DIR=<dir with node_modules/playwright-core> node tests/integration/editor-inline-notifications-check.mjs
// Env: CHROME_PATH, OUT (evidence .txt), SHOTS (screenshot dir)

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const BASE = "http://localhost:8188";
const DB = "supporthub-iso-postgres";
const CHROME = process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const SHOTS = path.resolve(ROOT, process.env.SHOTS || "evidence/frontend-inline-notifications");
const ACCOUNTS = process.env.ACCOUNTS_FILE || path.join(ROOT, "..", "SupportHub_group12-integration", "infra/floci/.generated/isolated/demo-accounts.txt");
const { chromium } = createRequire(path.join(process.env.PW_DIR || ROOT, "package.json"))("playwright-core");
const PASSWORD = fs.readFileSync(ACCOUNTS, "utf8").match(/^password=(.+)$/m)[1].trim();
fs.mkdirSync(SHOTS, { recursive: true });

const OVERRIDES = {
  "/editor.html": fs.readFileSync(path.join(ROOT, "frontend/editor.html")),
  "/js/editorial.js": fs.readFileSync(path.join(ROOT, "frontend/js/editorial.js"))
};
const sha = b => crypto.createHash("sha256").update(b).digest("hex").slice(0, 12);

const lines = []; let pass = 0, fail = 0;
const log = t => { lines.push(t); console.log(t); };
const check = (n, ok, d = "") => { ok ? pass++ : fail++; log(`${ok ? "PASS" : "FAIL"} | ${n}${d ? " | " + d : ""}`); };
const sql = q => execFileSync("docker", ["exec", DB, "psql", "-U", "supporthub", "-d", "supporthub", "-tAc", q], { encoding: "utf8" }).trim();
const sleep = ms => new Promise(r => setTimeout(r, ms));

class Client {
  constructor() { this.cookie = ""; this.csrf = null; }
  async raw(method, url, body, headers = {}) {
    const h = { Accept: "application/json", Origin: BASE, ...headers };
    if (this.cookie) h.Cookie = this.cookie;
    if (body !== undefined) h["Content-Type"] = "application/json";
    const res = await fetch(BASE + url, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
    for (const c of res.headers.getSetCookie?.() || []) if (c.startsWith("supporthub.sid=")) this.cookie = c.split(";")[0];
    let data = {}; try { data = await res.json(); } catch {}
    return { status: res.status, data };
  }
  async write(method, url, body) { if (!this.csrf) this.csrf = (await this.raw("GET", "/api/auth/csrf")).data.csrfToken; return this.raw(method, url, body, { "X-CSRF-Token": this.csrf }); }
  async login(email) { const r = await this.write("POST", "/api/auth/login", { email, password: PASSWORD }); if (r.data.csrfToken) this.csrf = r.data.csrfToken; return r; }
}

const term = "notice" + Date.now().toString(36);
const LONG = t => `Inline notice check ${t}: open the settings, follow every step in order, restart the device, then contact support if the problem continues afterwards.`;
log(`My Articles inline notices check ${new Date().toISOString()} - isolated ${BASE}`);
log(`worktree files served: editor.html sha256 ${sha(OVERRIDES["/editor.html"])}, js/editorial.js sha256 ${sha(OVERRIDES["/js/editorial.js"])}`);

const author = new Client(), editor = new Client();
check("author login (author@supporthub.test)", (await author.login("author@supporthub.test")).status === 200);
check("editor login (editor@supporthub.test)", (await editor.login("editor@supporthub.test")).status === 200);
const cat = Number(sql("SELECT id FROM categories ORDER BY id LIMIT 1"));
const mk = async (title, content) => (await author.write("POST", "/api/articles", { title, categoryId: cat, content })).data.article?.id;
const shortId = await mk(`Notice short ${term}`, "Too short to review.");
const okId = await mk(`Notice ok ${term}`, LONG("ok " + term));
const dblId = await mk(`Notice double ${term}`, LONG("double " + term));
check("setup drafts created via API", !!(shortId && okId && dblId), `short ${shortId}, ok ${okId}, double ${dblId}`);

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const problems = [];
async function newPage(client) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const [k, ...v] = client.cookie.split("=");
  await context.addCookies([{ name: k, value: v.join("="), url: BASE, httpOnly: true, sameSite: "Lax" }]);
  const served = new Set();
  await context.route(u => OVERRIDES[new URL(u).pathname] !== undefined, async route => {
    const p = new URL(route.request().url()).pathname;
    const orig = await route.fetch();
    served.add(p);
    await route.fulfill({ status: 200, headers: orig.headers(), body: OVERRIDES[p] });
  });
  const page = await context.newPage();
  page.on("pageerror", e => problems.push(`pageerror: ${e.message.slice(0, 160)}`));
  page.on("console", m => { if (/Content Security Policy|Refused to/i.test(m.text())) problems.push(`CSP: ${m.text().slice(0, 160)}`); });
  page.on("dialog", d => d.accept());
  return { page, served, context };
}
const card = (page, title) => page.locator("#my-articles article.article-card").filter({ has: page.locator("h3", { hasText: new RegExp(`^${title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`) }) });

try {
  const { page, served } = await newPage(author);
  const submits = [];
  page.on("request", q => { if (q.method() === "POST" && /\/api\/articles\/\d+\/submit$/.test(q.url())) submits.push(q.url().replace(BASE, "")); });
  await page.goto(`${BASE}/editor.html`, { waitUntil: "networkidle" });
  check("worktree editor.html and js/editorial.js were served", served.has("/editor.html") && served.has("/js/editorial.js"));
  await card(page, `Notice short ${term}`).waitFor({ timeout: 15000 });

  // ---- 1) 422 shown under the affected article
  const sc = card(page, `Notice short ${term}`);
  const r422 = page.waitForResponse(x => x.url().endsWith(`/api/articles/${shortId}/submit`));
  await sc.getByRole("button", { name: "Submit for Review" }).click();
  const res422 = await r422;
  const n422 = sc.locator(".article-notice.article-notice-error");
  await n422.waitFor({ timeout: 10000 });
  const t422 = (await n422.innerText()).trim();
  check("422 -> red notice inside the affected card", res422.status() === 422 && /at least 100 characters/.test(t422), `${res422.status()} "${t422}"`);
  check("error notice has role=alert", (await n422.getAttribute("role")) === "alert");
  const colors = await n422.evaluate(e => { const s = getComputedStyle(e); return `${s.color} on ${s.backgroundColor}`; });
  check("error notice is red", colors === "rgb(153, 27, 27) on rgb(254, 242, 242)", colors);
  const btnBox = await sc.getByRole("button", { name: "Submit for Review" }).boundingBox(), nBox = await n422.boundingBox();
  check("notice is below the card's buttons", nBox.y > btnBox.y, `notice y=${Math.round(nBox.y)} button y=${Math.round(btnBox.y)}`);
  check("no notice on any other card", await page.locator("#my-articles .article-notice").count() === 1);
  check("submit button re-enabled after the error", await sc.getByRole("button", { name: "Submit for Review" }).isEnabled());
  check("422 left the article a draft (DB)", sql(`SELECT status FROM articles WHERE id = ${shortId}`) === "draft");
  await sc.scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(SHOTS, "01-422-error-below-article.png") });

  // ---- 2) repeated clicks: one request, button disabled, pending notice while in flight
  const dc = card(page, `Notice double ${term}`);
  await page.route(`**/api/articles/${dblId}/submit`, async route => { await sleep(2000); await route.continue(); });
  const dbtn = dc.getByRole("button", { name: "Submit for Review" });
  const before = submits.length;
  await dbtn.dblclick();
  const pending = dc.locator(".article-notice.article-notice-pending");
  await pending.waitFor({ timeout: 3000 });
  const disabledInFlight = await dbtn.isDisabled();
  let extraClick = "ignored";
  try { await dbtn.click({ timeout: 800 }); extraClick = "clicked"; } catch { extraClick = "refused (button disabled)"; }
  await dc.scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(SHOTS, "02-pending-button-disabled.png") });
  check("pending notice shown while the request runs", (await pending.innerText()).trim() === "Submitting article...");
  check("submit button disabled during the request", disabledInFlight, `third click ${extraClick}`);
  const dcAfter = card(page, `Notice double ${term}`);
  await dcAfter.locator(".article-notice-success").waitFor({ timeout: 15000 });
  check("double-click + extra click sent exactly ONE submit request", submits.length - before === 1, `${submits.length - before} request(s)`);
  check("exactly one outbox event for that article (DB)", sql(`SELECT count(*) FROM article_event_outbox WHERE article_id = ${dblId} AND event_type = 'article.submitted'`) === "1");
  await page.unroute(`**/api/articles/${dblId}/submit`);

  // ---- 3) success: green notice survives the list refresh
  const oc = card(page, `Notice ok ${term}`);
  const r200 = page.waitForResponse(x => x.url().endsWith(`/api/articles/${okId}/submit`));
  const rList = page.waitForResponse(x => x.url().endsWith("/api/articles/mine") && x.request().method() === "GET");
  await oc.getByRole("button", { name: "Submit for Review" }).click();
  const res200 = await r200; await rList;
  const ocNew = card(page, `Notice ok ${term}`);
  const nOk = ocNew.locator(".article-notice.article-notice-success");
  await nOk.waitFor({ timeout: 10000 });
  await sleep(500);
  check("submit -> 200", res200.status() === 200, `${res200.status()}`);
  check("list refreshed: card shows Status: in_review and no Submit/Edit/Delete buttons", /Status: in_review/i.test(await ocNew.innerText()) && await ocNew.getByRole("button", { name: /Submit for Review|Edit|Delete/ }).count() === 0, (await ocNew.locator(".status").innerText()).trim());
  check("green notice still visible after the refresh", await nOk.isVisible() && (await nOk.innerText()).trim() === "Article submitted for review.");
  const okColors = await nOk.evaluate(e => { const s = getComputedStyle(e); return `${s.color} on ${s.backgroundColor}`; });
  check("success notice is green, role=status", okColors === "rgb(22, 101, 52) on rgb(240, 253, 244)" && (await nOk.getAttribute("role")) === "status", okColors);
  check("only the submitted article has a success notice", await page.locator("#my-articles .article-notice-success").count() === 1);
  await ocNew.scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(SHOTS, "03-success-after-refresh.png") });

  // ---- 4) existing draft create / edit / version history / delete through the UI
  await page.goto(`${BASE}/editor.html`, { waitUntil: "networkidle" });
  const ct = `Notice crud ${term}`;
  await page.fill("#article-title", ct);
  await page.selectOption("#article-category", String(cat));
  await page.fill("#article-content", LONG("crud " + term));
  await page.locator("#article-form button[type=submit]").click();
  await page.locator("#editor-message", { hasText: "Draft saved successfully." }).waitFor({ timeout: 15000 });
  await card(page, ct).waitFor({ timeout: 10000 });
  const crudId = Number(sql(`SELECT id FROM articles WHERE title = '${ct}'`));
  check("create draft through the form", crudId > 0, `article ${crudId}`);

  await card(page, ct).getByRole("button", { name: "Edit" }).click();
  check("Edit fills the form", (await page.inputValue("#article-id")) === String(crudId) && (await page.inputValue("#article-title")) === ct);
  await page.fill("#article-title", ct + " edited");
  await page.locator("#article-form button[type=submit]").click();
  await page.locator("#editor-message", { hasText: "Draft saved successfully." }).waitFor({ timeout: 15000 });
  await card(page, ct + " edited").waitFor({ timeout: 10000 });
  check("edit draft through the form", sql(`SELECT title FROM articles WHERE id = ${crudId}`) === ct + " edited");

  await card(page, ct + " edited").getByRole("button", { name: "Version History" }).click();
  await page.waitForURL(`**/versions.html?articleId=${crudId}`, { timeout: 10000 });
  await page.locator("#restore-version option").nth(2).waitFor({ state: "attached", timeout: 15000 });
  check("Version History opens with both versions", await page.locator("#restore-version option").count() >= 3);
  await page.goto(`${BASE}/editor.html`, { waitUntil: "networkidle" });

  await card(page, ct + " edited").getByRole("button", { name: "Delete" }).click();
  await page.locator("#editor-message", { hasText: "Article deleted successfully." }).waitFor({ timeout: 15000 });
  check("delete draft (confirm accepted)", await card(page, ct + " edited").count() === 0 && sql(`SELECT count(*) FROM articles WHERE id = ${crudId}`) === "0");
  await page.screenshot({ path: path.join(SHOTS, "04-after-crud.png") });

  // ---- 5) Salma's Editorial review dashboard with the same editorial.js
  const ed = await newPage(editor);
  await ed.page.goto(`${BASE}/review.html`, { waitUntil: "networkidle" });
  check("review.html loaded the worktree js/editorial.js", ed.served.has("/js/editorial.js"));
  const queued = ed.page.locator("#review-list").getByText(`Notice ok ${term}`);
  await queued.first().waitFor({ timeout: 30000 }).catch(() => {});
  check("Editorial review queue lists the article submitted above", await queued.count() > 0);
  check("review queue offers Approve and Reject", await ed.page.locator("#review-list").getByRole("button", { name: /approve/i }).count() > 0 && await ed.page.locator("#review-list").getByRole("button", { name: /reject/i }).count() > 0);
  await ed.page.screenshot({ path: path.join(SHOTS, "05-editorial-review-queue.png"), fullPage: false });

  check("no CSP violations or page errors on editor.html, versions.html, review.html", problems.length === 0, problems.join("; "));
} finally { await browser.close(); }

log(`Total: ${pass} passed, ${fail} failed`);
if (process.env.OUT) fs.writeFileSync(path.resolve(ROOT, process.env.OUT), lines.join("\n") + "\n");
process.exitCode = fail ? 1 : 0;
