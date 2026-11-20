const crypto = require("node:crypto");
const { HttpError } = require("./http");
function signedHeaders(sender, method, path, body = "") {
  const secret = process.env.SERVICE_SHARED_SECRET;
  if (!secret || secret.length < 32) throw new HttpError(503, "Service-to-service secret not configured");
  const timestamp = String(Date.now());
  const hash = crypto.createHash("sha256").update(body).digest("hex");
  const payload = `${sender}\n${timestamp}\n${method}\n${path}\n${hash}`;
  return {
    "x-service-name": sender,
    "x-service-timestamp": timestamp,
    "x-service-signature": crypto.createHmac("sha256", secret).update(payload).digest("hex")
  };
}
async function serviceRequest(origin, method, path, data) {
  if (!origin) throw new HttpError(503, "Dependent service URL not configured");
  const url = new URL(path, origin.endsWith("/") ? origin : origin + "/");
  if (!["http:", "https:"].includes(url.protocol)) throw new HttpError(503, "Unsupported service URL");
  if (process.env.NODE_ENV === "production" && url.protocol !== "https:")
    throw new HttpError(503, "Internal requests must use HTTPS in production");
  const body = data === undefined ? "" : JSON.stringify(data);
  const response = await fetch(url, {
    method,
    headers: { ...signedHeaders("editorial-service", method, url.pathname + url.search, body),
      ...(body ? { "content-type": "application/json" } : {}) },
    body: body || undefined,
    signal: AbortSignal.timeout(10000)
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new HttpError(response.status, result.error || `Internal service returned ${response.status}`);
  return result;
}
async function getArticle(articleId) {
  const result = await serviceRequest(process.env.ARTICLE_SERVICE_URL, "GET", `/internal/articles/${articleId}`);
  return result.article;
}
async function transitionArticle(articleId, from, to, operationId) {
  if (
    typeof operationId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(operationId)
  ) {
    throw new HttpError(400, "A valid workflow operation ID is required");
  }

  const result = await serviceRequest(
    process.env.ARTICLE_SERVICE_URL,
    "PATCH",
    `/internal/articles/${articleId}/status`,
    { operationId, from, to }
  );

  return result.article;
}
async function notifySearch(articleId) {
  return serviceRequest(process.env.SEARCH_SERVICE_URL, "POST", "/internal/publications", { articleId });
}
module.exports = { signedHeaders, serviceRequest, getArticle, transitionArticle, notifySearch };
