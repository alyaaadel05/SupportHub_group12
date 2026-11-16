const pool = require("../db/pool");
const { HttpError, id, boundedString } = require("./http");
const { classify } = require("./sentimentService");
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
  await pool.query(`UPDATE article_feedback SET sentiment_status=$2,sentiment_label=$3,
    sentiment_confidence=$4 WHERE feedback_id=$1`,
    [feedbackId,sentiment.status,sentiment.label,sentiment.confidence]).catch(e =>
      console.error("Feedback sentiment update failed:", e.message));
  return { feedbackId, saved: true, sentiment };
}
module.exports = { vote, comment };
