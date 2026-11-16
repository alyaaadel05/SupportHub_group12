const pool = require("../db/pool");
const { canAccess } = require("../middleware/security");
function httpError(status, message) { const error = new Error(message); error.status = status; return error; }
function validId(value) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw httpError(400, "Invalid ID");
  return id;
}
function validateArticle(data) {
  if (!data || typeof data.title !== "string" || typeof data.content !== "string") {
    throw httpError(400, "Title and content are required strings");
  }
  const title = data.title.trim(), content = data.content.trim();
  if (title.length < 3 || title.length > 200 || content.length < 10 || content.length > 20000) {
    throw httpError(400, "Title must be 3-200 and content 10-20000 characters");
  }
  return { title, content, categoryId: validId(data.categoryId ?? data.category_id) };
}
async function categoryExists(client, categoryId) {
  const { rowCount } = await client.query("SELECT 1 FROM categories WHERE category_id=$1", [categoryId]);
  if (!rowCount) throw httpError(400, "Invalid category");
}
async function findById(id) {
  const { rows } = await pool.query("SELECT * FROM articles WHERE article_id=$1", [id]);
  return rows[0] || null;
}
async function create(input, user) {
  const data = validateArticle(input);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await categoryExists(client, data.categoryId);
    const { rows } = await client.query(
      `INSERT INTO articles(title,content,category_id,author_id,status)
       VALUES($1,$2,$3,$4,'draft') RETURNING *`,
      [data.title, data.content, data.categoryId, user.id]);
    await client.query(
      `INSERT INTO article_versions(article_id,version_number,title,content,category_id,edited_by)
       VALUES($1,1,$2,$3,$4,$5)`,
      [rows[0].article_id, data.title, data.content, data.categoryId, user.id]);
    await client.query("COMMIT");
    return rows[0];
  } catch(e) { await client.query("ROLLBACK"); throw e; }
  finally { client.release(); }
}
async function update(id, input, user) {
  const data = validateArticle(input);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query("SELECT * FROM articles WHERE article_id=$1 FOR UPDATE", [id]);
    const old = rows[0];
    if (!old) throw httpError(404, "Article not found");
    if (!canAccess(old,user)) throw httpError(403, "Forbidden");
    if (old.status !== "draft") throw httpError(409, "Only draft articles can be edited");
    await categoryExists(client, data.categoryId);
    const { rows: changed } = await client.query(
      `UPDATE articles SET title=$1,content=$2,category_id=$3,updated_at=NOW()
       WHERE article_id=$4 RETURNING *`, [data.title,data.content,data.categoryId,id]);
    const { rows: versions } = await client.query(
      "SELECT COALESCE(MAX(version_number),0) AS n FROM article_versions WHERE article_id=$1", [id]);
    await client.query(
      `INSERT INTO article_versions(article_id,version_number,title,content,category_id,edited_by)
       VALUES($1,$2,$3,$4,$5,$6)`,
      [id,Number(versions[0].n)+1,data.title,data.content,data.categoryId,user.id]);
    await client.query("COMMIT");
    return changed[0];
  } catch(e) { await client.query("ROLLBACK"); throw e; }
  finally { client.release(); }
}
async function remove(id, user) {
  const article = await findById(id);
  if (!article) throw httpError(404,"Article not found");
  if (!canAccess(article,user)) throw httpError(403,"Forbidden");
  if (article.status !== "draft") throw httpError(409,"Only drafts can be deleted");
  await pool.query("DELETE FROM articles WHERE article_id=$1 AND status='draft'",[id]);
}
async function mine(user) {
  const { rows } = await pool.query(
    `SELECT article_id,title,category_id,status,created_at,updated_at FROM articles
     WHERE author_id=$1 ORDER BY updated_at DESC LIMIT 200`,[user.id]);
  return rows;
}
async function transitionStatus(id, from, to) {
  const allowed = { draft: ["in_review"], in_review: ["draft", "approved"], approved: ["published", "draft"], published: ["draft"] };
  if (!allowed[from]?.includes(to)) throw httpError(400,"Disallowed status transition");
  const { rows } = await pool.query(
    `UPDATE articles SET status=$1, updated_at=NOW(), published_at=
      CASE WHEN $1='published' THEN NOW() WHEN $1='draft' THEN NULL ELSE published_at END
     WHERE article_id=$2 AND status=$3 RETURNING *`,[to,id,from]);
  return rows[0] || null;
}
module.exports = { httpError, validId, validateArticle, findById, create, update, remove, mine, transitionStatus };
