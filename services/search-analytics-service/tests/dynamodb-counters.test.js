const test = require("node:test");
const assert = require("node:assert/strict");
const { dynamo } = require("../services/awsClients");
const counters = require("../services/countersService");

// Replace the real DynamoDB call with a fake one, so these tests need no AWS.
function fakeDynamo(handler) {
  const sent = [];
  dynamo.send = async (command) => { sent.push(command.input); return handler(command.input); };
  return sent;
}

test("search counter uses TERM# key, adds 1 search and counts zero results", async () => {
  process.env.DYNAMODB_COUNTERS_TABLE = "supporthub-search-counters";
  const sent = fakeDynamo(() => ({}));
  assert.equal(counters.recordSearch("  Password ", 0).queued, true);
  const result = await counters.flush();
  assert.equal(result.sent, 1);
  assert.equal(sent[0].TableName, "supporthub-search-counters");
  assert.deepEqual(sent[0].Key, { pk: "TERM#password" });
  assert.deepEqual(Object.values(sent[0].ExpressionAttributeNames), ["searches", "zeroResults"]);
  assert.equal(sent[0].ExpressionAttributeValues[":v0"], 1);
  assert.equal(sent[0].ExpressionAttributeValues[":v1"], 1);
});

test("search with results does not add a zero-result count", async () => {
  process.env.DYNAMODB_COUNTERS_TABLE = "supporthub-search-counters";
  const sent = fakeDynamo(() => ({}));
  counters.recordSearch("password", 3);
  await counters.flush();
  assert.equal(sent[0].ExpressionAttributeValues[":v1"], 0);
});

test("many searches for the same term become ONE DynamoDB update", async () => {
  process.env.DYNAMODB_COUNTERS_TABLE = "supporthub-search-counters";
  const sent = fakeDynamo(() => ({}));
  counters.recordSearch("password", 1);
  counters.recordSearch("PASSWORD", 0);
  counters.recordSearch("password", 2);
  counters.recordView(1);
  counters.recordView(1);
  const result = await counters.flush();
  assert.equal(result.sent, 2);
  const term = sent.find(i => i.Key.pk === "TERM#password");
  const article = sent.find(i => i.Key.pk === "ARTICLE#1");
  assert.equal(term.ExpressionAttributeValues[":v0"], 3);
  assert.equal(term.ExpressionAttributeValues[":v1"], 1);
  assert.equal(article.ExpressionAttributeValues[":v0"], 2);
  assert.equal(counters.pendingCount(), 0);
});

test("empty search is not counted", async () => {
  const sent = fakeDynamo(() => ({}));
  const result = counters.recordSearch("   ", 0);
  assert.equal(result.skipped, true);
  await counters.flush();
  assert.equal(sent.length, 0);
});

test("article view counter uses ARTICLE# key", async () => {
  process.env.DYNAMODB_COUNTERS_TABLE = "supporthub-search-counters";
  const sent = fakeDynamo(() => ({}));
  counters.recordView(1);
  await counters.flush();
  assert.deepEqual(sent[0].Key, { pk: "ARTICLE#1" });
  assert.deepEqual(Object.values(sent[0].ExpressionAttributeNames), ["views"]);
});

test("DynamoDB failure does not throw (search keeps working)", async () => {
  process.env.DYNAMODB_COUNTERS_TABLE = "supporthub-search-counters";
  fakeDynamo(() => { const e = new Error("down"); e.name = "ResourceNotFoundException"; throw e; });
  counters.recordSearch("password", 1);
  const result = await counters.flush();
  assert.equal(result.failed, 1);
});

test("no table configured means counters are skipped", async () => {
  delete process.env.DYNAMODB_COUNTERS_TABLE;
  const sent = fakeDynamo(() => ({}));
  const result = counters.recordView(1);
  assert.equal(result.skipped, true);
  await counters.flush();
  assert.equal(sent.length, 0);
});

test("live counters are read, split by type and sorted", async () => {
  process.env.DYNAMODB_COUNTERS_TABLE = "supporthub-search-counters";
  fakeDynamo(() => ({ Items: [
    { pk: "TERM#login", searches: 2, zeroResults: 0 },
    { pk: "TERM#password", searches: 5, zeroResults: 1 },
    { pk: "ARTICLE#1", views: 9 }
  ] }));
  const result = await counters.liveCounters();
  assert.equal(result.available, true);
  assert.deepEqual(result.terms[0], { term: "password", searches: 5, zeroResults: 1 });
  assert.deepEqual(result.articles, [{ articleId: "1", views: 9 }]);
});

test("live counters report unavailable when DynamoDB fails", async () => {
  process.env.DYNAMODB_COUNTERS_TABLE = "supporthub-search-counters";
  fakeDynamo(() => { throw new Error("down"); });
  const result = await counters.liveCounters();
  assert.equal(result.available, false);
});