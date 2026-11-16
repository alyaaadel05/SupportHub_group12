const pool = require("../db/pool");
const { HttpError, id, text } = require("./http");
const { getArticle } = require("./serviceClient");
async function flag(articleId, user, body) {
  articleId = id(articleId);
  const reason = text(body?.reason, 1000, "Reason");
  const article = await getArticle(articleId);
  if (!article) throw new HttpError(404, "Article not found");
  if (article.status !== "published") throw new HttpError(409, "Only published articles can be flagged");
  const { rows } = await pool.query(`INSERT INTO editorial_outdated_flags(article_id,flagged_by,reason)
    VALUES($1,$2,$3) RETURNING *`, [articleId,user.id,reason]);
  return rows[0];
}
async function resolve(flagId, user, body) {
  flagId = id(flagId);
  const note = text(body?.resolution ?? "", 1000, "Resolution", false);
  const { rows } = await pool.query(`UPDATE editorial_outdated_flags SET status='resolved',resolved_by=$2,
    resolution=$3,resolved_at=NOW() WHERE flag_id=$1 AND status='open' RETURNING *`, [flagId,user.id,note]);
  if (!rows[0]) throw new HttpError(404, "Open flag not found");
  return rows[0];
}
module.exports = { flag, resolve };
