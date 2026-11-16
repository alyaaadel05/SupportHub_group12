const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { signedHeaders } = require("../services/serviceClient");
test("signs internal requests in Article Service format", () => {
  process.env.SERVICE_SHARED_SECRET = "a".repeat(40);
  const headers = signedHeaders("editorial-service", "GET", "/internal/articles/42");
  const bodyHash = crypto.createHash("sha256").update("").digest("hex");
  const msg = `editorial-service\n${headers["x-service-timestamp"]}\nGET\n/internal/articles/42\n${bodyHash}`;
  const expected = crypto.createHmac("sha256", "a".repeat(40)).update(msg).digest("hex");
  assert.equal(headers["x-service-signature"], expected);
});
