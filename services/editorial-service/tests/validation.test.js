const test = require("node:test");
const assert = require("node:assert/strict");
const { id, text } = require("../services/http");
test("validates positive numeric identifiers", () => {
  assert.equal(id("17"), 17);
  assert.throws(() => id("0"), /Invalid/);
  assert.throws(() => id("xyz"), /Invalid/);
});
test("trims comments and limits length", () => {
  assert.equal(text("  looks good  ", 50, "Comment"), "looks good");
  assert.throws(() => text("x".repeat(51), 50, "Comment"), /characters/);
});
