const pool = require("../db/pool");
const { notifySearch } = require("./serviceClient");
async function queueNotification(client, articleId) {
  const { rows } = await client.query(`INSERT INTO publication_outbox(article_id,state,next_attempt_at)
    VALUES($1,'pending',NOW()) RETURNING *`, [articleId]);
  return rows[0];
}
async function attempt(outboxId) {
  const { rows } = await pool.query(
    `SELECT * FROM publication_outbox WHERE outbox_id=$1 AND state='pending'`, [outboxId]);
  const item = rows[0];
  if (!item) return { status: "already_handled" };
  try {
    await notifySearch(item.article_id);
    await pool.query("UPDATE publication_outbox SET state='delivered',delivered_at=NOW(),last_error=NULL WHERE outbox_id=$1", [outboxId]);
    return { status: "delivered" };
  } catch (error) {
    await pool.query(`UPDATE publication_outbox SET attempts=attempts+1, last_error=$2,
      next_attempt_at=NOW() + INTERVAL '5 minutes' WHERE outbox_id=$1`, [outboxId, String(error.message).slice(0,250)]);
    return { status: "pending", error: "Search notification unsuccessful; retry required" };
  }
}
async function retryPending(limit = 20) {
  const { rows } = await pool.query(`SELECT outbox_id FROM publication_outbox
    WHERE state='pending' AND next_attempt_at <= NOW()
    ORDER BY outbox_id LIMIT $1`, [limit]);
  const results = [];
  for (const row of rows) results.push({ id: row.outbox_id, ...(await attempt(row.outbox_id)) });
  return results;
}
module.exports = { queueNotification, attempt, retryPending };
