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
  const result = await counters.recordSearch("  Password ", 0);
  assert.equal(result.ok, true);
  assert.equal(sent[0].TableName, "supporthub-search-counters");
  assert.deepEqual(sent[0].Key, { pk: "TERM#password" });
  assert.deepEqual(Object.values(sent[0].ExpressionAttributeNames), ["searches", "zeroResults"]);
  assert.equal(sent[0].ExpressionAttributeValues[":v0"], 1);
  assert.equal(sent[0].ExpressionAttributeValues[":v1"], 1);
});

test("search with results does not add a zero-result count", async () => {
  process.env.DYNAMODB_COUNTERS_TABLE = "supporthub-search-counters";
  const sent = fakeDynamo(() => ({}));
  await counters.recordSearch("password", 3);
  assert.equal(sent[0].ExpressionAttributeValues[":v1"], 0);
});

test("empty search is not counted", async () => {
  const sent = fakeDynamo(() => ({}));
  const result = await counters.recordSearch("   ", 0);
  assert.equal(result.skipped, true);
  assert.equal(sent.length, 0);
});

test("article view counter uses ARTICLE# key", async () => {
  process.env.DYNAMODB_COUNTERS_TABLE = "supporthub-search-counters";
  const sent = fakeDynamo(() => ({}));
  await counters.recordView(1);
  assert.deepEqual(sent[0].Key, { pk: "ARTICLE#1" });
  assert.deepEqual(Object.values(sent[0].ExpressionAttributeNames), ["views"]);
});

test("DynamoDB failure does not throw (search keeps working)", async () => {
  process.env.DYNAMODB_COUNTERS_TABLE = "supporthub-search-counters";
  fakeDynamo(() => { const e = new Error("down"); e.name = "ResourceNotFoundException"; throw e; });
  const result = await counters.recordSearch("password", 1);
  assert.equal(result.ok, false);
});

test("no table configured means counters are skipped", async () => {
  delete process.env.DYNAMODB_COUNTERS_TABLE;
  const sent = fakeDynamo(() => ({}));
  const result = await counters.recordView(1);
  assert.equal(result.skipped, true);
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