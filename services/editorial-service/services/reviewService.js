const pool = require("../db/pool");
const { HttpError, id, text } = require("./http");
const { getArticle, transitionArticle } = require("./serviceClient");

async function submit(articleId, user) {
  articleId = id(articleId);
  const article = await getArticle(articleId);
  if (!article) throw new HttpError(404, "Article not found");
  if (Number(article.author_id) !== user.id) throw new HttpError(403, "Only the author can submit");
  if (article.status !== "draft") throw new HttpError(409, "Only drafts can be submitted");
  if (!article.title?.trim() || !article.content?.trim() || !article.category_id)
    throw new HttpError(400, "Incomplete article");
  const existing = await pool.query("SELECT 1 FROM editorial_reviews WHERE article_id=$1 AND decision='pending' LIMIT 1", [articleId]);
  if (existing.rowCount) throw new HttpError(409, "Review already pending");
  // The owning Article Service performs the authoritative state change.
  await transitionArticle(articleId, "draft", "in_review");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `INSERT INTO editorial_reviews(article_id,submitted_by,decision) VALUES($1,$2,'pending') RETURNING *`,
      [articleId, user.id]);
    await client.query(`INSERT INTO editorial_status_events(article_id,actor_id,previous_status,new_status)
      VALUES($1,$2,'draft','in_review')`, [articleId, user.id]);
    await client.query("COMMIT");
    return rows[0];
  } catch (e) { await client.query("ROLLBACK"); throw e; }
  finally { client.release(); }
}
async function queue(status) {
  if (!["pending", "approved", "rejected"].includes(status)) throw new HttpError(400, "Invalid review status");
  const { rows } = await pool.query(
    `SELECT * FROM editorial_reviews WHERE decision=$1 ORDER BY created_at DESC LIMIT 100`, [status]);
  return rows;
}
async function decide(articleId, user, body) {
  articleId = id(articleId);
  const decision = body?.decision;
  if (!["approved", "rejected"].includes(decision)) throw new HttpError(400, "Decision must be approved or rejected");
  const comments = text(body?.comments ?? "", 2000, "Comments", false);
  const article = await getArticle(articleId);
  if (!article) throw new HttpError(404, "Article not found");
  if (Number(article.author_id) === user.id) throw new HttpError(403, "Cannot review your own article");
  if (article.status !== "in_review") throw new HttpError(409, "Article is not in review");
  const { rows } = await pool.query(
    `SELECT * FROM editorial_reviews WHERE article_id=$1 AND decision='pending' ORDER BY review_id DESC LIMIT 1`, [articleId]);
  if (!rows[0]) throw new HttpError(409, "No pending review");
  const to = decision === "approved" ? "approved" : "draft";
  await transitionArticle(articleId, "in_review", to);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `UPDATE editorial_reviews SET decision=$1, reviewer_id=$2, comments=$3, decided_at=NOW()
       WHERE review_id=$4 AND decision='pending' RETURNING *`,
       [decision, user.id, comments, rows[0].review_id]);
    if (!result.rowCount) throw new HttpError(409, "Review already processed");
    await client.query(`INSERT INTO editorial_status_events(article_id,actor_id,previous_status,new_status)
      VALUES($1,$2,'in_review',$3)`, [articleId,user.id,to]);
    await client.query("COMMIT");
    return result.rows[0];
  } catch(e) { await client.query("ROLLBACK"); throw e; }
  finally { client.release(); }
}
module.exports = { submit, queue, decide };
