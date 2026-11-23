
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  requireLogin,
  requireAuthor,
  requireReviewer,
  requireBrowserWrite,
  requireCronSecret
} = require("../middleware/security");

function mockRequest(user) {
  return {
    session: user ? { user } : {},
    user: undefined
  };
}

function mockResponse() {
  return {
    statusCode: 200,
    body: null,

    status(code) {
      this.statusCode = code;
      return this;
    },

    json(body) {
      this.body = body;
      return this;
    }
  };
}

function runMiddleware(middleware, user) {
  const req = mockRequest(user);
  const res = mockResponse();
  let nextCalled = false;

  middleware(req, res, () => {
    nextCalled = true;
  });

  return { req, res, nextCalled };
}

// Authentication and role authorization tests

test("unauthenticated users cannot access protected functions", () => {
  for (const middleware of [
    requireLogin,
    requireAuthor,
    requireReviewer
  ]) {
    const result = runMiddleware(middleware, null);

    assert.equal(result.res.statusCode, 401);
    assert.equal(result.nextCalled, false);
  }
});

test("authors can access author functions", () => {
  const result = runMiddleware(requireAuthor, {
    id: 10,
    role: "author"
  });

  assert.equal(result.nextCalled, true);
  assert.equal(result.req.user.id, 10);
});

test("readers cannot access author functions", () => {
  const result = runMiddleware(requireAuthor, {
    id: 11,
    role: "reader"
  });

  assert.equal(result.res.statusCode, 403);
  assert.equal(result.nextCalled, false);
});

test("reviewers can access editorial functions", () => {
  const result = runMiddleware(requireReviewer, {
    id: 12,
    role: "reviewer"
  });

  assert.equal(result.nextCalled, true);
  assert.equal(result.req.user.role, "reviewer");
});

test("admins can access editorial functions", () => {
  const result = runMiddleware(requireReviewer, {
    id: 13,
    role: "admin"
  });

  assert.equal(result.nextCalled, true);
});

test("legacy editors remain temporarily compatible", () => {
  const result = runMiddleware(requireReviewer, {
    id: 14,
    role: "editor"
  });

  assert.equal(result.nextCalled, true);
});

test("authors cannot access reviewer functions", () => {
  const result = runMiddleware(requireReviewer, {
    id: 15,
    role: "author"
  });

  assert.equal(result.res.statusCode, 403);
  assert.equal(result.nextCalled, false);
});

test("readers cannot access reviewer functions", () => {
  const result = runMiddleware(requireReviewer, {
    id: 16,
    role: "reader"
  });

  assert.equal(result.res.statusCode, 403);
  assert.equal(result.nextCalled, false);
});

test("invalid user IDs cannot authenticate", () => {
  for (const invalidId of [0, -1, "abc", null]) {
    const result = runMiddleware(requireLogin, {
      id: invalidId,
      role: "admin"
    });

    assert.equal(result.res.statusCode, 401);
    assert.equal(result.nextCalled, false);
  }
});

test("role comparison is case insensitive", () => {
  const result = runMiddleware(requireReviewer, {
    id: 17,
    role: "REVIEWER"
  });

  assert.equal(result.nextCalled, true);
});

// CSRF and browser Origin protection tests

function runBrowserWrite({
  method = "POST",
  origin,
  expectedToken,
  suppliedToken
}) {
  const req = {
    method,
    session: expectedToken
      ? { csrfToken: expectedToken }
      : {},

    get(name) {
      const headers = {
        Origin: origin,
        "X-CSRF-Token": suppliedToken
      };

      return headers[name];
    }
  };

  const res = mockResponse();
  let nextCalled = false;

  const previousOrigin = process.env.FRONTEND_ORIGIN;

  process.env.FRONTEND_ORIGIN = "http://localhost:8080";

  try {
    requireBrowserWrite(req, res, () => {
      nextCalled = true;
    });
  } finally {
    if (previousOrigin === undefined) {
      delete process.env.FRONTEND_ORIGIN;
    } else {
      process.env.FRONTEND_ORIGIN = previousOrigin;
    }
  }

  return { res, nextCalled };
}

const validCsrfToken = "a".repeat(64);

test("browser writes reject a missing Origin", () => {
  const result = runBrowserWrite({
    expectedToken: validCsrfToken,
    suppliedToken: validCsrfToken
  });

  assert.equal(result.res.statusCode, 403);
  assert.equal(result.nextCalled, false);
});

test("browser writes reject an incorrect Origin", () => {
  const result = runBrowserWrite({
    origin: "http://evil.example",
    expectedToken: validCsrfToken,
    suppliedToken: validCsrfToken
  });

  assert.equal(result.res.statusCode, 403);
  assert.equal(result.nextCalled, false);
});

test("browser writes reject a missing CSRF token", () => {
  const result = runBrowserWrite({
    origin: "http://localhost:8080",
    expectedToken: validCsrfToken
  });

  assert.equal(result.res.statusCode, 403);
  assert.equal(result.nextCalled, false);
});

test("browser writes reject malformed CSRF tokens", () => {
  const result = runBrowserWrite({
    origin: "http://localhost:8080",
    expectedToken: "invalid",
    suppliedToken: "invalid"
  });

  assert.equal(result.res.statusCode, 403);
  assert.equal(result.nextCalled, false);
});

test("browser writes reject an incorrect CSRF token", () => {
  const result = runBrowserWrite({
    origin: "http://localhost:8080",
    expectedToken: validCsrfToken,
    suppliedToken: "b".repeat(64)
  });

  assert.equal(result.res.statusCode, 403);
  assert.equal(result.nextCalled, false);
});

test("browser writes accept a valid Origin and CSRF token", () => {
  const result = runBrowserWrite({
    origin: "http://localhost:8080",
    expectedToken: validCsrfToken,
    suppliedToken: validCsrfToken
  });

  assert.equal(result.res.statusCode, 200);
  assert.equal(result.nextCalled, true);
});

test("safe GET requests do not require Origin or CSRF tokens", () => {
  const result = runBrowserWrite({
    method: "GET"
  });

  assert.equal(result.nextCalled, true);
});

// Internal cron endpoint authentication tests

function runCronSecret(secret, authorization) {
  const req = {
    get(name) {
      return name.toLowerCase() === "authorization"
        ? authorization
        : undefined;
    }
  };

  const res = mockResponse();
  let nextCalled = false;

  const previousSecret = process.env.CRON_SECRET;
  process.env.CRON_SECRET = secret;

  try {
    requireCronSecret(req, res, () => {
      nextCalled = true;
    });
  } finally {
    if (previousSecret === undefined) {
      delete process.env.CRON_SECRET;
    } else {
      process.env.CRON_SECRET = previousSecret;
    }
  }

  return { res, nextCalled };
}

test("cron endpoint rejects a missing secret", () => {
  const result = runCronSecret("", "Bearer ");

  assert.equal(result.res.statusCode, 401);
  assert.equal(result.nextCalled, false);
});

test("cron endpoint rejects a secret shorter than 32 characters", () => {
  const result = runCronSecret(
    "short-secret",
    "Bearer short-secret"
  );

  assert.equal(result.res.statusCode, 401);
  assert.equal(result.nextCalled, false);
});

test("cron endpoint rejects an incorrect secret", () => {
  const secret = "a".repeat(40);

  const result = runCronSecret(
    secret,
    `Bearer ${"b".repeat(40)}`
  );

  assert.equal(result.res.statusCode, 401);
  assert.equal(result.nextCalled, false);
});

test("cron endpoint accepts the correct secret", () => {
  const secret = "a".repeat(40);

  const result = runCronSecret(
    secret,
    `Bearer ${secret}`
  );

  assert.equal(result.nextCalled, true);
});
