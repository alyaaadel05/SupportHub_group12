const test = require("node:test");
const assert = require("node:assert/strict");
const { parseSearch } = require("../services/ranking");

test("frontend 'category' parameter filters the same as 'categoryID'", () => {
  assert.equal(parseSearch({ category: "1" }).categoryId, parseSearch({ categoryID: "1" }).categoryId);
  assert.notEqual(parseSearch({ category: "1" }).categoryId, null);
});

test("no category means no filter", () => {
  assert.equal(parseSearch({}).categoryId, null);
});

test("invalid frontend 'category' is rejected with 400", () => {
  assert.throws(() => parseSearch({ category: "abc" }), error => error.status === 400);
});