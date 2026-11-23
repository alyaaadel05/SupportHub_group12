"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { getCsrfToken } = require("../controllers/csrfController");

function mockResponse() {
  return {
    statusCode: null,
    headers: {},
    body: null,

    set(name, value) {
      this.headers[name] = value;
      return this;
    },

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

test("creates and saves a cryptographically random CSRF token", () => {
  let saved = false;

  const req = {
    session: {
      save(callback) {
        saved = true;
        callback(null);
      }
    }
  };

  const res = mockResponse();
  let nextError;

  getCsrfToken(req, res, (error) => {
    nextError = error;
  });

  assert.equal(nextError, undefined);
  assert.equal(saved, true);
  assert.match(req.session.csrfToken, /^[a-f0-9]{64}$/);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { csrfToken: req.session.csrfToken });
  assert.equal(res.headers["Cache-Control"], "no-store");
});

test("reuses an existing valid CSRF token", () => {
  const existingToken = "a".repeat(64);

  const req = {
    session: {
      csrfToken: existingToken,
      save(callback) {
        callback(null);
      }
    }
  };

  const res = mockResponse();

  getCsrfToken(req, res, () => {
    assert.fail("Unexpected error");
  });

  assert.equal(req.session.csrfToken, existingToken);
  assert.deepEqual(res.body, { csrfToken: existingToken });
});

test("replaces an invalid existing CSRF token", () => {
  const req = {
    session: {
      csrfToken: "invalid",
      save(callback) {
        callback(null);
      }
    }
  };

  const res = mockResponse();

  getCsrfToken(req, res, () => {
    assert.fail("Unexpected error");
  });

  assert.match(req.session.csrfToken, /^[a-f0-9]{64}$/);
  assert.notEqual(req.session.csrfToken, "invalid");
});

test("does not return a token when session saving fails", () => {
  const saveError = new Error("Session database unavailable");

  const req = {
    session: {
      save(callback) {
        callback(saveError);
      }
    }
  };

  const res = mockResponse();
  let nextError;

  getCsrfToken(req, res, (error) => {
    nextError = error;
  });

  assert.equal(nextError, saveError);
  assert.equal(res.body, null);
});

test("rejects a missing session", () => {
  const res = mockResponse();
  let nextError;

  getCsrfToken({}, res, (error) => {
    nextError = error;
  });

  assert.match(nextError.message, /Session unavailable/);
  assert.equal(res.body, null);
});
