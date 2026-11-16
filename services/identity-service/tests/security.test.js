
const test = require("node:test");
const assert = require("node:assert/strict");

// Test-only configuration.
// Do not use these values in production.
process.env.DATABASE_URL =
  process.env.DATABASE_URL ||
  "postgresql://test:test@localhost:5432/test";

process.env.SESSION_SECRET =
  process.env.SESSION_SECRET ||
  "test-only-secret-at-least-32-characters-long";

const {
  generateCsrfToken,
  requireAuth,
  requireRole,
  requireCsrf
} = require("../middleware/security");

function responseMock() {
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

test("CSRF tokens have 64 hexadecimal characters", () => {
  const token = generateCsrfToken();

  assert.match(token, /^[a-f0-9]{64}$/);
});

test("CSRF tokens are different", () => {
  const first = generateCsrfToken();
  const second = generateCsrfToken();

  assert.notEqual(first, second);
});

test("Unauthenticated requests are rejected", () => {
  const req = { session: {} };
  const res = responseMock();

  let called = false;

  requireAuth(req, res, () => {
    called = true;
  });

  assert.equal(res.statusCode, 401);
  assert.equal(called, false);
});

test("Users without the correct role are rejected", () => {
  const req = {
    session: {
      user: {
        id: 1,
        role: "reader"
      }
    }
  };

  const res = responseMock();

  requireRole("reviewer")(req, res, () => {});

  assert.equal(res.statusCode, 403);
});

test("Valid CSRF tokens are accepted", () => {
  const token = generateCsrfToken();

  const req = {
    session: {
      csrfToken: token
    },
    get(name) {
      return name === "X-CSRF-Token" ? token : undefined;
    }
  };

  const res = responseMock();

  let called = false;

  requireCsrf(req, res, () => {
    called = true;
  });

  assert.equal(called, true);
});

test("Invalid CSRF tokens are rejected", () => {
  const req = {
    session: {
      csrfToken: generateCsrfToken()
    },
    get() {
      return generateCsrfToken();
    }
  };

  const res = responseMock();

  requireCsrf(req, res, () => {});

  assert.equal(res.statusCode, 403);
});

