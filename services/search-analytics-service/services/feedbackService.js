const pool = require("../db/pool");
const { HttpError, id, boundedString } = require("./http");
const { classify } = require("./sentimentService");
const autoFlag = require("./autoFlagService");
async function published(articleId) {
  const r = await pool.query("SELECT 1 FROM search_published_articles WHERE article_id=$1", [articleId]);
  if (!r.rowCount) throw new HttpError(404, "Published article not found");
}
async function vote(articleId, userId, helpful) {
  articleId = id(articleId);
  if (typeof helpful !== "boolean") throw new HttpError(400, "helpful must be boolean");
  await published(articleId);
  const result = await pool.query(`INSERT INTO helpfulness_votes(article_id,user_id,helpful)
    VALUES($1,$2,$3) ON CONFLICT(article_id,user_id) DO UPDATE
    SET helpful=EXCLUDED.helpful, updated_at=NOW() RETURNING *`, [articleId,userId,helpful]);
  // An unhelpful vote may ask Editorial for an automatic re-review. Awaited because Vercel stops
  // work after the response; it never throws, so the vote is saved even if Editorial is down.
  if (!result.rows[0].helpful) await autoFlag.checkAfterUnhelpfulVote(articleId);
  return { articleId, helpful: result.rows[0].helpful, saved: true };
}
async function comment(articleId, userId, text) {
  articleId = id(articleId);
  text = boundedString(text, 1000, "feedback text");
  await published(articleId);
  // Feedback survives a failed external sentiment request.
  const saved = await pool.query(`INSERT INTO article_feedback(article_id,user_id,comment_text,sentiment_status)
    VALUES($1,$2,$3,'pending') RETURNING feedback_id`, [articleId,userId,text]);
  const feedbackId = saved.rows[0].feedback_id;
  const sentiment = await classify(text);
  const stored = await pool.query(`UPDATE article_feedback SET sentiment_status=$2,sentiment_label=$3,
    sentiment_confidence=$4 WHERE feedback_id=$1`,
    [feedbackId,sentiment.status,sentiment.label,sentiment.confidence]).then(() => true, e => {
      console.error("Feedback sentiment update failed:", e.message);
      return false;
    });
  // Report what is actually stored: if the update failed the row stays 'pending'
  // and scripts/reprocess-sentiment.js completes it later.
  return { feedbackId, saved: true, sentiment: stored ? sentiment : { status: "pending", label: null, confidence: null } };
}
// Recovery: feedback whose sentiment was never stored ('pending', e.g. the
// update failed or the process stopped after the insert) or could not be
// analysed ('unavailable') is classified again. Rows younger than 1 minute are
// skipped so in-flight requests are not touched. Idempotent; bounded batch.
async function reprocessSentiment(limit = 100) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 100, 500));
  const { rows } = await pool.query(`SELECT feedback_id, comment_text FROM article_feedback
    WHERE sentiment_status IN ('pending','unavailable') AND created_at < NOW() - INTERVAL '1 minute'
    ORDER BY feedback_id LIMIT $1`, [safeLimit]);
  const result = { checked: rows.length, completed: 0, unavailable: 0, failed: 0 };
  for (const item of rows) {
    const sentiment = await classify(item.comment_text);
    try {
      const updated = await pool.query(`UPDATE article_feedback SET sentiment_status=$2,sentiment_label=$3,
        sentiment_confidence=$4 WHERE feedback_id=$1 AND sentiment_status IN ('pending','unavailable')`,
        [item.feedback_id, sentiment.status, sentiment.label, sentiment.confidence]);
      if (updated.rowCount && sentiment.status === "completed") result.completed += 1;
      else if (updated.rowCount) result.unavailable += 1;
    } catch (error) {
      result.failed += 1;
      console.error("Feedback sentiment reprocess failed:", item.feedback_id, error.message);
    }
  }
  return result;
}
module.exports = { vote, comment, reprocessSentiment };