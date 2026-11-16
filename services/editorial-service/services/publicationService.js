const pool = require("../db/pool");
const { HttpError, id } = require("./http");
const { getArticle, transitionArticle } = require("./serviceClient");
const notifications = require("./notificationService");
async function publish(articleId, user) {
  articleId = id(articleId);
  const article = await getArticle(articleId);
  if (!article) throw new HttpError(404, "Article not found");
  if (Number(article.author_id) === user.id) throw new HttpError(403, "Cannot publish your own article");
  if (article.status !== "approved") throw new HttpError(409, "Article must be approved first");
  const approved = await pool.query(`SELECT 1 FROM editorial_reviews WHERE article_id=$1 AND decision='approved' LIMIT 1`, [articleId]);
  if (!approved.rowCount) throw new HttpError(409, "No approved review found");
  await transitionArticle(articleId, "approved", "published");
  // Cross-service transactions are not atomic. If this DB write fails, reconciliation is necessary.
  const client = await pool.connect();
  let outbox;
  try {
    await client.query("BEGIN");
    await client.query(`INSERT INTO editorial_status_events(article_id,actor_id,previous_status,new_status)
      VALUES($1,$2,'approved','published')`, [articleId,user.id]);
    outbox = await notifications.queueNotification(client, articleId);
    await client.query("COMMIT");
  } catch(e) { await client.query("ROLLBACK"); throw e; }
  finally { client.release(); }
  const delivery = await notifications.attempt(outbox.outbox_id);
  return { articleId, status: "published", searchable: delivery.status === "delivered", deliveryStatus: delivery.status };
}
module.exports = { publish };
