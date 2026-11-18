const test = require("node:test");
const assert = require("node:assert/strict");
const { id, boundedString } = require("../services/http");
const { parseSearch } = require("../services/ranking");

test("valid article ID is accepted", () => {
  assert.equal(id("5"), 5);
});

test("invalid article IDs are rejected with 400", () => {
  for (const bad of ["0", "-1", "abc", "1.5", "", "1; DROP TABLE articles"]) {
    assert.throws(() => id(bad), { status: 400 }, `should reject ${bad}`);
  }
});

test("feedback text is trimmed", () => {
  assert.equal(boundedString("  great article  ", 1000, "feedback text"), "great article");
});

test("empty feedback is rejected with 400", () => {
  assert.throws(() => boundedString("   ", 1000, "feedback text"), { status: 400 });
});

test("feedback over 1000 characters is rejected with 400", () => {
  assert.throws(() => boundedString("a".repeat(1001), 1000, "feedback text"), { status: 400 });
});

test("non-text feedback is rejected with 400", () => {
  assert.throws(() => boundedString(123, 1000, "feedback text"), { status: 400 });
  assert.throws(() => boundedString({ text: "hi" }, 1000, "feedback text"), { status: 400 });
});

test("valid search input is accepted", () => {
  const result = parseSearch({ q: "router", page: "2", categoryID: "3" });
  assert.equal(result.q, "router");
  assert.equal(result.page, 2);
  assert.equal(result.categoryId, 3);
});

test("search longer than 100 characters is rejected with 400", () => {
  assert.throws(() => parseSearch({ q: "a".repeat(101) }), { status: 400 });
});

test("invalid page numbers are rejected with 400", () => {
  for (const bad of ["0", "101", "abc", "1.5"]) {
    assert.throws(() => parseSearch({ page: bad }), { status: 400 }, `should reject page ${bad}`);
  }
});

test("invalid category ID is rejected with 400", () => {
  assert.throws(() => parseSearch({ categoryID: "abc" }), { status: 400 });
});

test("search with no keyword and no page defaults to page 1", () => {
  const result = parseSearch({});
  assert.equal(result.page, 1);
  assert.equal(result.q, "");
  assert.equal(result.categoryId, null);
});