const { makeSignature } = require("../middleware/security");
const { HttpError, id } = require("./http");
async function getPublishedArticle(articleId) {
  const secret = process.env.SERVICE_SHARED_SECRET;
  const origin = process.env.ARTICLE_SERVICE_URL;
  if (!origin || !secret || secret.length < 32) throw new HttpError(503, "Article API not configured");
  const url = new URL(`/internal/articles/${id(articleId)}`, origin);
  if (process.env.NODE_ENV === "production" && url.protocol !== "https:")
    throw new HttpError(503, "Article API must use HTTPS");
  const ts = String(Date.now()), path = url.pathname + url.search;
  let response;
  try {
    response = await fetch(url, {
      headers: {
        "x-service-name": "search-analytics-service",
        "x-service-timestamp": ts,
        "x-service-signature": makeSignature(secret, "search-analytics-service", ts, "GET", path)
      }, signal: AbortSignal.timeout(9000)
    });
  } catch { throw new HttpError(502, "Article API unavailable"); }
  if (response.status === 404) throw new HttpError(404, "Published article not found");
  if (!response.ok) throw new HttpError(502, "Article API failed");
  const result = await response.json();
  if (result.article?.status !== "published") throw new HttpError(404, "Article not published");
  return result.article;
}
// Signed request to the Editorial Service to open an automatic re-review flag.
// The signature covers the exact JSON body string that is sent. Short timeout: this runs
// inside a vote request, so a slow Editorial must not keep the reader waiting.
async function requestAutoFlag(articleId, unhelpfulVotes, totalVotes) {
  const secret = process.env.SERVICE_SHARED_SECRET;
  const origin = process.env.EDITORIAL_SERVICE_URL;
  if (!origin || !secret || secret.length < 32) throw new HttpError(503, "Editorial API not configured");
  const url = new URL("/internal/auto-flags", origin);
  if (process.env.NODE_ENV === "production" && url.protocol !== "https:")
    throw new HttpError(503, "Editorial API must use HTTPS");
  const body = JSON.stringify({ articleId: id(articleId), unhelpfulVotes, totalVotes });
  const ts = String(Date.now());
  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-service-name": "search-analytics-service",
        "x-service-timestamp": ts,
        "x-service-signature": makeSignature(secret, "search-analytics-service", ts, "POST", url.pathname, body)
      },
      body,
      signal: AbortSignal.timeout(3000)
    });
  } catch { throw new HttpError(502, "Editorial API unavailable"); }
  return response.status;
}
module.exports = { getPublishedArticle, requestAutoFlag };