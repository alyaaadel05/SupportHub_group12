
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  requireAuth,
  allowRoles,
  csrfProtection
} = require("../middleware/security");

function makeResponse() {
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

function makeRequest(user, token, headerToken) {
  return {
    method: "POST",
    session: { user, csrfToken: token },
    get(name) {
      return name === "X-CSRF-Token"
        ? headerToken
        : undefined;
    }
  };
}

test("1. Unauthenticated access is rejected", () => {
  const req = makeRequest(null);
  const res = makeResponse();
  let passed = false;

  requireAuth(req, res, () => { passed = true; });

  assert.equal(res.statusCode, 401);
  assert.equal(passed, false);
});

test("2. Authenticated access is allowed", () => {
  const req = makeRequest({ id: 1, role: "author" });
  const res = makeResponse();
  let passed = false;

  requireAuth(req, res, () => { passed = true; });

  assert.equal(passed, true);
});

test("3. Missing login blocks role-protected routes", () => {
  const req = makeRequest(null);
  const res = makeResponse();

  allowRoles("editor")(req, res, () => {});

  assert.equal(res.statusCode, 401);
});

test("4. Authors cannot access editor routes", () => {
  const req = makeRequest({ id: 1, role: "author" });
  const res = makeResponse();

  allowRoles("editor")(req, res, () => {});

  assert.equal(res.statusCode, 403);
});

test("5. Editors may access editor routes", () => {
  const req = makeRequest({ id: 2, role: "editor" });
  const res = makeResponse();
  let passed = false;

  allowRoles("editor")(req, res, () => {
    passed = true;
  });

  assert.equal(passed, true);
});

test("6. Read-only GET requests do not require CSRF", () => {
  const req = makeRequest(null);
  req.method = "GET";

  const res = makeResponse();
  let passed = false;

  csrfProtection(req, res, () => { passed = true; });

  assert.equal(passed, true);
});

test("7. Missing CSRF token is rejected", () => {
  const req = makeRequest(null, "abc", undefined);
  const res = makeResponse();

  csrfProtection(req, res, () => {});

  assert.equal(res.statusCode, 403);
});

test("8. Incorrect CSRF token is rejected", () => {
  const req = makeRequest(null, "correct", "wrong");
  const res = makeResponse();

  csrfProtection(req, res, () => {});

  assert.equal(res.statusCode, 403);
});

test("9. Correct CSRF token is accepted", () => {
  const req = makeRequest(null, "secret123", "secret123");
  const res = makeResponse();
  let passed = false;

  csrfProtection(req, res, () => { passed = true; });

  assert.equal(passed, true);
});
