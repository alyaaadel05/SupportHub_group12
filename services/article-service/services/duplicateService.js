const STOPWORDS = new Set(["a","an","and","are","as","at","be","by","for","from","how","in","is","it","of","on","or","the","to","was","what","when","where","with"]);
function tokens(input) {
  return new Set(String(input || "").toLowerCase().normalize("NFKC")
    .replace(/(?<=[\p{L}\p{N}])-(?=[\p{L}\p{N}])/gu, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/).filter(word => word.length > 1 && !STOPWORDS.has(word)));
}
function jaccard(a, b) {
  const left = tokens(a), right = tokens(b);
  if (!left.size || !right.size) return 0;
  let intersection = 0;
  for (const value of left) if (right.has(value)) intersection++;
  return intersection / (left.size + right.size - intersection);
}
function scoreArticle(input, candidate) {
  const title = jaccard(input.title, candidate.title);
  const content = jaccard(input.content, candidate.content);
  return Math.round((title * 0.65 + content * 0.35) * 10000) / 100;
}
async function findDuplicates(pool, user, input, excludeId) {
  // Never reveal another author's drafts. Published records are available to all authors.
  const query = `SELECT article_id, title, content, status FROM articles
    WHERE (status = 'published' OR author_id = $1 OR $2 = true)
      AND ($3::bigint IS NULL OR article_id <> $3)
    ORDER BY updated_at DESC LIMIT 500`;
  const { rows } = await pool.query(query, [user.id, user.role === "reviewer", excludeId || null]);
  return rows.map(a => ({
    articleId: a.article_id, title: a.title,
    score: scoreArticle(input, a), status: a.status
  })).filter(a => a.score >= 25).sort((a,b) => b.score-a.score).slice(0, 10);
}
module.exports = { tokens, jaccard, scoreArticle, findDuplicates };
