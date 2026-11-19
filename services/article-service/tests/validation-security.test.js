
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");

const {
  validateArticle,
  validId
} = require("../services/articleService");

const {
  canAccess,
  requireLogin,
  requireRole,
  requireCsrf,
  assertOrigin
} = require("../middleware/security");

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

const validArticle = {
  title: "Reset Router",
  content: "Instructions for resetting the router.",
  categoryId: 1
};

// ARTICLE VALIDATION

test("Valid article data is accepted", () => {
  const result = validateArticle(validArticle);
  assert.equal(result.title, "Reset Router");
  assert.equal(result.categoryId, 1);
});

test("Article title shorter than 3 characters is rejected", () => {
  assert.throws(
    () => validateArticle({ ...validArticle, title: "Hi" }),
    { status: 400 }
  );
});

test("Article content shorter than 10 characters is rejected", () => {
  assert.throws(
    () => validateArticle({ ...validArticle, content: "Short" }),
    { status: 400 }
  );
});

test("Invalid category ID is rejected", () => {
  assert.throws(
    () => validateArticle({ ...validArticle, categoryId: -1 }),
    { status: 400 }
  );
});

test("Invalid article ID is rejected", () => {
  assert.throws(() => validId("abc"), { status: 400 });
});

test("Article data is trimmed", () => {
  const result = validateArticle({
    ...validArticle,
    title: "  Reset Router  "
  });
  assert.equal(result.title, "Reset Router");
});

// OWNERSHIP

test("Author can access own article", () => {
  assert.equal(
    canAccess(
      { author_id: 5 },
      { id: 5, role: "author" }
    ),
    true
  );
});

test("Author cannot access another author's article", () => {
  assert.equal(
    canAccess(
      { author_id: 8 },
      { id: 5, role: "author" }
    ),
    false
  );
});

test("Administrator can access an article", () => {
  assert.equal(
    canAccess(
      { author_id: 8 },
      { id: 5, role: "admin" }
    ),
    true
  );
});

test("Unauthenticated Article request is rejected", () => {
  const req = { session: {} };
  const res = mockResponse();
  let nextCalled = false;

  requireLogin(req, res, () => {
    nextCalled = true;
  });

  assert.equal(res.statusCode, 401);
  assert.equal(nextCalled, false);
});

test("Editor cannot use author-only Article route", () => {
  const req = {
    session: {
      user: { id: 5, role: "editor" }
    }
  };
  const res = mockResponse();

  requireRole("author", "admin")(req, res, () => {});

  assert.equal(res.statusCode, 403);
});

// CSRF

test("Missing CSRF token is rejected", () => {
  const req = {
    method: "POST",
    session: { csrfToken: crypto.randomBytes(32).toString("hex") },
    get() { return undefined; }
  };
  const res = mockResponse();

  requireCsrf(req, res, () => {});

  assert.equal(res.statusCode, 403);
});

test("Valid CSRF token is accepted", () => {
  const token = crypto.randomBytes(32).toString("hex");
  const req = {
    method: "POST",
    session: { csrfToken: token },
    get(name) {
      return name === "X-CSRF-Token" ? token : undefined;
    }
  };
  const res = mockResponse();
  let nextCalled = false;

  requireCsrf(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
});

// ORIGIN

test("Unauthorized Origin is rejected", () => {
  const req = {
    method: "POST",
    get() { return "https://attacker.example"; }
  };
  const res = mockResponse();

  assertOrigin("http://127.0.0.1:8788")(
    req, res, () => {}
  );

  assert.equal(res.statusCode, 403);
});

test("Allowed Origin is accepted", () => {
  const req = {
    method: "POST",
    get() { return "http://127.0.0.1:8788"; }
  };
  const res = mockResponse();
  let nextCalled = false;

  assertOrigin("http://127.0.0.1:8788")(
    req, res, () => {
      nextCalled = true;
    }
  );

  assert.equal(nextCalled, true);
});

