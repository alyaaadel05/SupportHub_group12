// Automatic re-review requests (Search -> Editorial). The database, the Editorial call,
// metrics and sentiment are replaced by fakes, so these tests touch no network or database.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

let counts = { total: 0, unhelpful: 0 };
let countQueries = 0;
const fakePool = {
  query: async (sql) => {
    if (sql.includes("FROM search_published_articles")) return { rowCount: 1, rows: [{}] };
    if (sql.includes("INSERT INTO helpfulness_votes")) return { rows: [{ helpful: lastHelpful }] };
    if (sql.includes("FROM helpfulness_votes")) { countQueries++; return { rows: [counts] }; }
    throw new Error("Unexpected query: " + sql.slice(0, 50));
  }
};
let lastHelpful = false;
const calls = [];
let editorial = async () => 201;

function fake(rel, exports) {
  const file = require.resolve(path.join(__dirname, rel));
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
}
fake("../db/pool", fakePool);
fake("../services/serviceClient", { requestAutoFlag: async (...args) => { calls.push(args); return editorial(); } });
fake("../services/metricsService", { record() {} });
fake("../services/sentimentService", { classify: async () => ({}) });

const { ruleMet } = require("../services/autoFlagService");
const { vote } = require("../services/feedbackService");

function reset(total, unhelpful, helpful = false) {
  counts = { total, unhelpful }; lastHelpful = helpful; calls.length = 0; countQueries = 0; editorial = async () => 201;
}

test("rule: at least 5 unhelpful AND more than 60 % unhelpful", () => {
  assert.equal(ruleMet(5, 8), true);   // 62.5 %
  assert.equal(ruleMet(5, 5), true);   // 100 %
  assert.equal(ruleMet(4, 5), false);  // only 4 unhelpful
  assert.equal(ruleMet(6, 10), false); // exactly 60 % is not enough
  assert.equal(ruleMet(0, 0), false);  // no votes
});

test("unhelpful vote that meets the rule asks Editorial with the counts", async () => {
  reset(8, 6);
  const result = await vote(12, 1, false);
  assert.equal(result.saved, true);
  assert.deepEqual(calls, [[12, 6, 8]]);
});

test("4 unhelpful votes: Editorial is not called", async () => {
  reset(5, 4);
  await vote(12, 1, false);
  assert.equal(calls.length, 0);
});

test("exactly 60 % unhelpful: Editorial is not called", async () => {
  reset(10, 6);
  await vote(12, 1, false);
  assert.equal(calls.length, 0);
});

test("helpful vote: no count query and no Editorial call", async () => {
  reset(8, 6, true);
  const result = await vote(12, 1, true);
  assert.equal(result.saved, true);
  assert.equal(countQueries, 0);
  assert.equal(calls.length, 0);
});

test("Editorial down (throws): the vote is still saved", async () => {
  reset(8, 6);
  editorial = async () => { throw new Error("Editorial API unavailable"); };
  const result = await vote(12, 1, false);
  assert.equal(result.saved, true);
  assert.equal(calls.length, 1);
});

test("Editorial busy (503): the vote is still saved", async () => {
  reset(8, 6);
  editorial = async () => 503;
  const result = await vote(12, 1, false);
  assert.equal(result.saved, true);
});