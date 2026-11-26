// Recovery of feedback whose sentiment was never stored. The database pool is
// replaced by a fake one; the REAL local sentiment model classifies the text.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const calls = [];
let rows = [];
let failUpdateFor = null;
const fakePool = {
  async query(sql, params = []) {
    calls.push({ sql, params });
    if (/^SELECT feedback_id, comment_text/.test(sql.trim())) return { rows };
    if (/^UPDATE article_feedback/.test(sql.trim())) {
      if (params[0] === failUpdateFor) throw new Error("update failed");
      return { rowCount: 1 };
    }
    return { rows: [] };
  }
};
const poolPath = require.resolve(path.join(__dirname, "../db/pool"));
require.cache[poolPath] = { id: poolPath, filename: poolPath, loaded: true, exports: fakePool };
const { reprocessSentiment } = require("../services/feedbackService");

test("reprocess classifies pending/unavailable feedback with the real model", async () => {
  calls.length = 0; failUpdateFor = null;
  rows = [{ feedback_id: 1, comment_text: "Excellent and helpful guide" }, { feedback_id: 2, comment_text: "Terrible and wrong" }];
  const result = await reprocessSentiment(10);
  assert.deepEqual(result, { checked: 2, completed: 2, unavailable: 0, failed: 0 });
  assert.match(calls[0].sql, /sentiment_status IN \('pending','unavailable'\)/);
  assert.match(calls[0].sql, /INTERVAL '1 minute'/);
  const updates = calls.filter(c => /^UPDATE/.test(c.sql.trim()));
  assert.equal(updates[0].params[2], "POSITIVE");
  assert.equal(updates[1].params[2], "NEGATIVE");
  assert.match(updates[0].sql, /AND sentiment_status IN \('pending','unavailable'\)/); // never overwrites completed rows
});

test("reprocess bounds the batch size", async () => {
  calls.length = 0; rows = [];
  await reprocessSentiment(100000);
  assert.equal(calls[0].params[0], 500);
});

test("a failing update is counted and does not stop the batch", async () => {
  calls.length = 0; failUpdateFor = 1;
  rows = [{ feedback_id: 1, comment_text: "good" }, { feedback_id: 2, comment_text: "bad" }];
  const result = await reprocessSentiment(10);
  assert.equal(result.failed, 1);
  assert.equal(result.completed, 1);
});

test("comment(): feedback is kept and the response says 'pending' when storing sentiment fails", async () => {
  const saved = [];
  const original = fakePool.query;
  fakePool.query = async (sql, params = []) => {
    const s = sql.trim();
    if (s.startsWith("SELECT 1 FROM search_published_articles")) return { rowCount: 1, rows: [{}] };
    if (s.startsWith("INSERT INTO article_feedback")) { saved.push(params); return { rows: [{ feedback_id: 42 }] }; }
    if (s.startsWith("UPDATE article_feedback")) throw new Error("update failed");
    return { rows: [] };
  };
  try {
    const { comment } = require("../services/feedbackService");
    const result = await comment(7, 3, "Excellent and helpful guide");
    assert.equal(result.saved, true);
    assert.equal(result.feedbackId, 42);
    assert.deepEqual(result.sentiment, { status: "pending", label: null, confidence: null });
    assert.equal(saved[0][2], "Excellent and helpful guide");
  } finally { fakePool.query = original; }
});
