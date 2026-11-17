
"use strict";

const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at",
  "be", "by", "for", "from", "how",
  "in", "is", "it", "of", "on", "or",
  "the", "to", "was", "what", "when",
  "where", "with"
]);

function tokens(input) {
  return new Set(
    String(input || "")
      .toLowerCase()
      .normalize("NFKC")
      .replace(
        /(?<=[\p{L}\p{N}])-(?=[\p{L}\p{N}])/gu,
        ""
      )
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter(
        word =>
          word.length > 1 &&
          !STOPWORDS.has(word)
      )
  );
}

function jaccard(a, b) {
  const left = tokens(a);
  const right = tokens(b);

  if (!left.size || !right.size) {
    return 0;
  }

  let intersection = 0;

  for (const value of left) {
    if (right.has(value)) {
      intersection++;
    }
  }

  return intersection /
    (left.size + right.size - intersection);
}

function scoreArticle(input, candidate) {
  const titleScore = jaccard(
    input.title,
    candidate.title
  );

  const contentScore = jaccard(
    input.content,
    candidate.content
  );

  return Math.round(
    (
      titleScore * 0.65 +
      contentScore * 0.35
    ) * 10000
  ) / 100;
}

async function findDuplicates(
  pool,
  user,
  input,
  excludeId
) {
  // Authors can see their own drafts and
  // other authors' published articles.
  // Administrators can inspect all articles.

  const query = `
    SELECT id, title, content, status
    FROM articles
    WHERE (
      status = 'published'
      OR author_id = $1
      OR $2 = TRUE
    )
    AND (
      $3::bigint IS NULL
      OR id <> $3
    )
    ORDER BY updated_at DESC
    LIMIT 500
  `;

  const { rows } = await pool.query(
    query,
    [
      user.id,
      user.role === "admin",
      excludeId ?? null
    ]
  );

  return rows
    .map(article => ({
      articleId: article.id,
      title: article.title,
      score: scoreArticle(input, article),
      status: article.status
    }))
    .filter(article => article.score >= 25)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);
}

module.exports = {
  tokens,
  jaccard,
  scoreArticle,
  findDuplicates
};
