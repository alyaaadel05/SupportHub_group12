// Live usage counters in DynamoDB (AWS service 1).
// Neon stays the source of truth (every search and view is stored there);
// DynamoDB keeps fast running totals per search term and per article.
// Increments are collected in memory and written in one UpdateItem per key
// every few seconds (load testing showed one DynamoDB call per search was the
// bottleneck at 100 users). A DynamoDB failure never breaks search.
const { UpdateCommand, ScanCommand } = require("@aws-sdk/lib-dynamodb");
const { dynamo } = require("./awsClients");

function tableName() { return process.env.DYNAMODB_COUNTERS_TABLE || ""; }
function termKey(term) { return "TERM#" + String(term).toLowerCase().trim().slice(0, 100); }
function articleKey(articleId) { return "ARTICLE#" + String(articleId); }

async function add(pk, values) {
  const table = tableName();
  if (!table) return { ok: false, skipped: true };
  const names = {}, vals = { ":now": new Date().toISOString() }, parts = [];
  Object.entries(values).forEach(([field, amount], i) => {
    names["#f" + i] = field;
    vals[":v" + i] = amount;
    parts.push("#f" + i + " :v" + i);
  });
  try {
    await dynamo.send(new UpdateCommand({
      TableName: table,
      Key: { pk },
      UpdateExpression: "ADD " + parts.join(", ") + " SET updatedAt = :now",
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: vals
    }));
    return { ok: true };
  } catch (error) {
    console.error("DynamoDB counter update failed:", error.name || "Error");
    return { ok: false };
  }
}

let pending = new Map();
let timer = null;

function queue(pk, values) {
  if (!tableName()) return { ok: false, skipped: true };
  const current = pending.get(pk) || {};
  for (const [field, amount] of Object.entries(values)) current[field] = (current[field] || 0) + amount;
  pending.set(pk, current);
  if (!timer) {
    timer = setInterval(flush, Number(process.env.COUNTERS_FLUSH_MS || 5000));
    timer.unref(); // never keeps the process alive on its own
  }
  return { ok: true, queued: true };
}

async function flush() {
  if (!pending.size || !tableName()) return { sent: 0, failed: 0 };
  const batch = pending;
  pending = new Map();
  let sent = 0, failed = 0;
  for (const [pk, values] of batch) {
    const result = await add(pk, values);
    if (result.ok) sent++; else failed++;
  }
  return { sent, failed };
}

function recordSearch(query, resultCount) {
  const q = String(query || "").trim();
  if (!q) return { ok: false, skipped: true };
  return queue(termKey(q), { searches: 1, zeroResults: resultCount === 0 ? 1 : 0 });
}

function recordView(articleId) {
  return queue(articleKey(articleId), { views: 1 });
}

function pendingCount() { return pending.size; }

async function liveCounters() {
  const table = tableName();
  if (!table) return { available: false, terms: [], articles: [] };
  try {
    const { Items = [] } = await dynamo.send(new ScanCommand({ TableName: table, Limit: 500 }));
    const terms = Items.filter(i => i.pk.startsWith("TERM#"))
      .map(i => ({ term: i.pk.slice(5), searches: i.searches || 0, zeroResults: i.zeroResults || 0 }))
      .sort((a, b) => b.searches - a.searches).slice(0, 10);
    const articles = Items.filter(i => i.pk.startsWith("ARTICLE#"))
      .map(i => ({ articleId: i.pk.slice(8), views: i.views || 0 }))
      .sort((a, b) => b.views - a.views).slice(0, 10);
    return { available: true, terms, articles };
  } catch (error) {
    console.error("DynamoDB counter read failed:", error.name || "Error");
    return { available: false, terms: [], articles: [] };
  }
}

module.exports = { recordSearch, recordView, flush, pendingCount, liveCounters, termKey, articleKey };