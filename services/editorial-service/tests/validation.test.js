
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  id,
  text,
  reviewComments
} = require("../services/http");

test("validates positive numeric identifiers", () => {
  assert.equal(id("17"), 17);
  assert.throws(() => id("0"), /Invalid/);
  assert.throws(() => id("xyz"), /Invalid/);
});

test("rejects non-decimal and padded identifiers", () => {
  assert.equal(id(42), 42);

  for (const value of ["0x1", "1e3", " 1", "1 ", "+1", "01", "1.0", "", null, undefined, true, "1 OR 1=1"]) {
    assert.throws(() => id(value), /Invalid/, String(value));
  }
});

test("trims comments and limits length", () => {
  assert.equal(text("  looks good  ", 50, "Comment"), "looks good");
  assert.throws(
    () => text("x".repeat(51), 50, "Comment"),
    /characters/
  );
});

test("rejection requires a non-empty explanation", () => {
  assert.throws(
    () => reviewComments("rejected", ""),
    /Rejection explanation/
  );

  assert.throws(
    () => reviewComments("rejected", "   "),
    /Rejection explanation/
  );
});

test("rejection accepts a valid explanation", () => {
  assert.equal(
    reviewComments("rejected", "Missing references"),
    "Missing references"
  );
});

test("approval does not require comments", () => {
  assert.equal(reviewComments("approved", ""), "");
});

test("review comments cannot exceed 2000 characters", () => {
  assert.throws(
    () => reviewComments("rejected", "x".repeat(2001)),
    /characters/
  );
});
