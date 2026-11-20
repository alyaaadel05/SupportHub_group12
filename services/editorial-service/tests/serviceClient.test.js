const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");

const {
  signedHeaders,
  transitionArticle
} = require("../services/serviceClient");

test("signs internal requests in Article Service format", () => {
  const previousSecret = process.env.SERVICE_SHARED_SECRET;

  try {
    process.env.SERVICE_SHARED_SECRET = "a".repeat(40);

    const headers = signedHeaders(
      "editorial-service",
      "GET",
      "/internal/articles/42"
    );

    const bodyHash = crypto
      .createHash("sha256")
      .update("")
      .digest("hex");

    const message =
      `editorial-service\n${headers["x-service-timestamp"]}\nGET\n/internal/articles/42\n${bodyHash}`;

    const expected = crypto
      .createHmac("sha256", "a".repeat(40))
      .update(message)
      .digest("hex");

    assert.equal(headers["x-service-signature"], expected);
  } finally {
    if (previousSecret === undefined) {
      delete process.env.SERVICE_SHARED_SECRET;
    } else {
      process.env.SERVICE_SHARED_SECRET = previousSecret;
    }
  }
});

test("rejects an invalid operation ID without making an HTTP request", async () => {
  const previousFetch = global.fetch;
  let fetchCalled = false;

  try {
    global.fetch = async () => {
      fetchCalled = true;
      throw new Error("fetch should not be called");
    };

    await assert.rejects(
      transitionArticle(42, "in_review", "approved", "not-a-uuid"),
      error => error.status === 400
    );

    assert.equal(fetchCalled, false);
  } finally {
    global.fetch = previousFetch;
  }
});

test("sends operation ID in the signed Article Service transition request", async () => {
  const previousFetch = global.fetch;
  const previousSecret = process.env.SERVICE_SHARED_SECRET;
  const previousArticleUrl = process.env.ARTICLE_SERVICE_URL;

  const operationId = "123e4567-e89b-42d3-a456-426614174000";
  const secret = "b".repeat(40);
  let capturedUrl;
  let capturedOptions;

  try {
    process.env.SERVICE_SHARED_SECRET = secret;
    process.env.ARTICLE_SERVICE_URL = "http://article-service:3000";

    global.fetch = async (url, options) => {
      capturedUrl = url;
      capturedOptions = options;

      return {
        ok: true,
        json: async () => ({
          article: {
            id: 42,
            status: "approved"
          }
        })
      };
    };

    const article = await transitionArticle(
      42,
      "in_review",
      "approved",
      operationId
    );

    const expectedBody = JSON.stringify({
      operationId,
      from: "in_review",
      to: "approved"
    });

    assert.equal(article.id, 42);
    assert.equal(article.status, "approved");
    assert.equal(
      capturedUrl.href,
      "http://article-service:3000/internal/articles/42/status"
    );
    assert.equal(capturedOptions.method, "PATCH");
    assert.equal(capturedOptions.body, expectedBody);
    assert.equal(
      capturedOptions.headers["content-type"],
      "application/json"
    );

    const bodyHash = crypto
      .createHash("sha256")
      .update(expectedBody)
      .digest("hex");

    const signaturePayload =
      `editorial-service\n${capturedOptions.headers["x-service-timestamp"]}\nPATCH\n/internal/articles/42/status\n${bodyHash}`;

    const expectedSignature = crypto
      .createHmac("sha256", secret)
      .update(signaturePayload)
      .digest("hex");

    assert.equal(
      capturedOptions.headers["x-service-signature"],
      expectedSignature
    );
  } finally {
    global.fetch = previousFetch;

    if (previousSecret === undefined) {
      delete process.env.SERVICE_SHARED_SECRET;
    } else {
      process.env.SERVICE_SHARED_SECRET = previousSecret;
    }

    if (previousArticleUrl === undefined) {
      delete process.env.ARTICLE_SERVICE_URL;
    } else {
      process.env.ARTICLE_SERVICE_URL = previousArticleUrl;
    }
  }
});
