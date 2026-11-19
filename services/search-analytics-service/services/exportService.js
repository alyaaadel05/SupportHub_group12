// Analytics CSV export to a private S3 bucket (AWS service 3).
// Reports contain only aggregate numbers, search terms and article titles -
// no user IDs, emails, sessions or feedback text.
const { PutObjectCommand, GetObjectCommand, ListObjectsV2Command } = require("@aws-sdk/client-s3");
const { s3 } = require("./awsClients");
const { HttpError } = require("./http");
const analytics = require("./analyticsService");

const PREFIX = "exports/";
const NAME_PATTERN = /^analytics-\d{8}T\d{6}Z\.csv$/;

function bucket() {
  const name = process.env.S3_EXPORT_BUCKET;
  if (!name) throw new HttpError(503, "Analytics export not configured");
  return name;
}

// Quote every cell and neutralise spreadsheet formulas (CSV injection):
// a search term such as =HYPERLINK(...) must stay plain text in Excel.
function cell(value) {
  let text = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
  return '"' + text.replace(/"/g, '""') + '"';
}
function row(values) { return values.map(cell).join(","); }

function toCsv(o, generatedAt) {
  const lines = [
    row(["section", "name", "value", "extra1", "extra2"]),
    row(["report", "generated_at", generatedAt, "", ""]),
    row(["summary", "total_searches", o.totalSearches, "", ""]),
    row(["summary", "successful_searches", o.successfulSearches, "", ""]),
    row(["summary", "zero_result_searches", o.zeroResultSearches, "", ""]),
    row(["summary", "search_success_rate_percent", o.searchSuccessRate, "", ""]),
    row(["summary", "zero_result_rate_percent", o.zeroResultRate, "", ""]),
    row(["summary", "click_through_rate_percent", o.clickThroughRate, "", ""]),
    row(["summary", "total_article_views", o.totalArticleViews, "", ""]),
    row(["summary", "total_votes", o.totalVotes, "", ""]),
    row(["summary", "helpfulness_rate_percent", o.helpfulnessRate, "", ""])
  ];
  for (const t of o.popularSearchTerms || []) lines.push(row(["popular_term", t.term, t.count, "", ""]));
  for (const t of o.knowledgeGaps || []) lines.push(row(["zero_result_term", t.term, t.count, "", ""]));
  for (const a of o.mostViewedArticles || [])
    lines.push(row(["article", a.title, a.views, a.helpful_votes, a.unhelpful_votes]));
  return lines.join("\n") + "\n";
}

function exportName(date) {
  return "analytics-" + date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "") + ".csv";
}

async function exportAnalytics(now = new Date()) {
  const overview = await analytics.overview();
  const csv = toCsv(overview, now.toISOString());
  const name = exportName(now);
  await s3.send(new PutObjectCommand({
    Bucket: bucket(), Key: PREFIX + name, Body: csv,
    ContentType: "text/csv; charset=utf-8", ServerSideEncryption: "AES256"
  }));
  return { name, bucket: bucket(), key: PREFIX + name, bytes: Buffer.byteLength(csv), rows: csv.trim().split("\n").length - 1 };
}

async function listExports() {
  const result = await s3.send(new ListObjectsV2Command({ Bucket: bucket(), Prefix: PREFIX, MaxKeys: 100 }));
  return (result.Contents || [])
    .map(o => ({ name: o.Key.slice(PREFIX.length), bytes: o.Size, lastModified: o.LastModified }))
    .filter(o => NAME_PATTERN.test(o.name))
    .sort((a, b) => (a.name < b.name ? 1 : -1));
}

async function getExport(name) {
  if (!NAME_PATTERN.test(String(name || ""))) throw new HttpError(400, "Invalid export name");
  try {
    const result = await s3.send(new GetObjectCommand({ Bucket: bucket(), Key: PREFIX + name }));
    return await result.Body.transformToString();
  } catch (error) {
    if (error.name === "NoSuchKey" || error.$metadata?.httpStatusCode === 404)
      throw new HttpError(404, "Export not found");
    throw error;
  }
}

module.exports = { toCsv, cell, exportName, exportAnalytics, listExports, getExport, NAME_PATTERN };