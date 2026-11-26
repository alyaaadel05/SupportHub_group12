const test = require("node:test");
const assert = require("node:assert/strict");
const { s3 } = require("../services/awsClients");
const analytics = require("../services/analyticsService");
const exportsService = require("../services/exportService");

const sample = {
  totalSearches: 10, successfulSearches: 8, zeroResultSearches: 2,
  searchSuccessRate: 80, zeroResultRate: 20, clickThroughRate: 30,
  totalArticleViews: 5, totalVotes: 4, helpfulnessRate: 75,
  popularSearchTerms: [{ term: "password", count: 6 }],
  knowledgeGaps: [{ term: "banana", count: 2 }],
  mostViewedArticles: [{ article_id: "1", title: "How to Reset Your Password", views: 5, helpful_votes: 3, unhelpful_votes: 1 }]
};

test("CSV contains real summary values, terms and articles", () => {
  const csv = exportsService.toCsv(sample, "2026-11-19T20:00:00.000Z");
  assert.match(csv, /"summary","total_searches","10"/);
  assert.match(csv, /"summary","helpfulness_rate_percent","75"/);
  assert.match(csv, /"popular_term","password","6"/);
  assert.match(csv, /"zero_result_term","banana","2"/);
  assert.match(csv, /"article","How to Reset Your Password","5","3","1"/);
});

test("CSV cells neutralise spreadsheet formulas (CSV injection)", () => {
  assert.equal(exportsService.cell("=HYPERLINK(\"x\")"), "\"'=HYPERLINK(\"\"x\"\")\"");
  assert.equal(exportsService.cell("+1"), "\"'+1\"");
  assert.equal(exportsService.cell("@cmd"), "\"'@cmd\"");
  assert.equal(exportsService.cell("normal"), "\"normal\"");
});

test("export file names follow a strict pattern", () => {
  const name = exportsService.exportName(new Date("2026-11-19T20:30:05.123Z"));
  assert.equal(name, "analytics-20261119T203005Z.csv");
  assert.ok(exportsService.NAME_PATTERN.test(name));
  assert.ok(!exportsService.NAME_PATTERN.test("../../secret.csv"));
});

test("export uploads an encrypted CSV to the configured private bucket", async () => {
  process.env.S3_EXPORT_BUCKET = "supporthub-search-analytics-exports";
  analytics.overview = async () => sample;
  const sent = [];
  s3.send = async (command) => { sent.push(command.input); return {}; };
  const result = await exportsService.exportAnalytics(new Date("2026-11-19T20:30:05Z"));
  assert.equal(sent[0].Bucket, "supporthub-search-analytics-exports");
  assert.equal(sent[0].Key, "exports/analytics-20261119T203005Z.csv");
  assert.equal(sent[0].ServerSideEncryption, "AES256");
  assert.match(sent[0].ContentType, /text\/csv/);
  assert.equal(result.name, "analytics-20261119T203005Z.csv");
  assert.ok(result.rows > 10);
});

test("download rejects unsafe export names (path traversal)", async () => {
  process.env.S3_EXPORT_BUCKET = "supporthub-search-analytics-exports";
  await assert.rejects(() => exportsService.getExport("../.env"), { status: 400 });
});

test("download of a missing export returns 404", async () => {
  process.env.S3_EXPORT_BUCKET = "supporthub-search-analytics-exports";
  s3.send = async () => { const e = new Error("missing"); e.name = "NoSuchKey"; throw e; };
  await assert.rejects(() => exportsService.getExport("analytics-20261119T203005Z.csv"), { status: 404 });
});

test("export fails safely with 503 when no bucket is configured", async () => {
  delete process.env.S3_EXPORT_BUCKET;
  analytics.overview = async () => sample;
  await assert.rejects(() => exportsService.exportAnalytics(), { status: 503 });
});
// ---- export storage unreachable (e.g. deployment without a reachable S3 endpoint)

test("export returns a clear 503 when S3 is unreachable (no internal details)", async () => {
  process.env.S3_EXPORT_BUCKET = "supporthub-search-analytics-exports";
  analytics.overview = async () => sample;
  s3.send = async () => { const e = new Error("getaddrinfo EAI_AGAIN floci"); e.code = "EAI_AGAIN"; throw e; };
  await assert.rejects(() => exportsService.exportAnalytics(), error =>
    error.status === 503 && error.message === "Analytics export storage unavailable" && !/floci|EAI_AGAIN/.test(error.message));
});

test("listing exports returns 503 when S3 times out", async () => {
  process.env.S3_EXPORT_BUCKET = "supporthub-search-analytics-exports";
  s3.send = async () => { const e = new Error("timeout"); e.name = "TimeoutError"; throw e; };
  await assert.rejects(() => exportsService.listExports(), { status: 503 });
});

test("download returns 503 for S3 access errors but still 404 for a missing export", async () => {
  process.env.S3_EXPORT_BUCKET = "supporthub-search-analytics-exports";
  s3.send = async () => { const e = new Error("denied"); e.name = "AccessDenied"; e.$metadata = { httpStatusCode: 403 }; throw e; };
  await assert.rejects(() => exportsService.getExport("analytics-20261119T203005Z.csv"), { status: 503 });
  s3.send = async () => { const e = new Error("missing"); e.$metadata = { httpStatusCode: 404 }; throw e; };
  await assert.rejects(() => exportsService.getExport("analytics-20261119T203005Z.csv"), { status: 404 });
});

test("S3 client fails fast (connection 3 s, request 8 s) inside the 10 s proxy budget", async () => {
  const handler = await s3.config.requestHandler;
  const cfg = handler.configProvider ? await handler.configProvider : handler.config || {};
  assert.equal(cfg.connectionTimeout, 3000);
  assert.equal(cfg.requestTimeout, 8000);
});
