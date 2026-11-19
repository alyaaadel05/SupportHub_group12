const test = require("node:test");
const assert = require("node:assert/strict");
const { noStore } = require("../middleware/security");

test("private responses are marked as not cacheable", () => {
  const headers = {};
  const res = { set(name, value) { headers[name] = value; } };
  let calledNext = false;
  noStore({}, res, () => { calledNext = true; });
  assert.equal(headers["Cache-Control"], "no-store, private");
  assert.equal(headers["Pragma"], "no-cache");
  assert.equal(calledNext, true);
});