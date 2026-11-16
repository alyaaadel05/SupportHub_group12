const { HttpError, id } = require("./http");
function words(s) { return [...new Set(String(s || "").toLowerCase().match(/[\p{L}\p{N}]+/gu) || [])].slice(0, 12); }
function scoreArticle(article, terms) {
  const title = String(article.title || "").toLowerCase();
  const content = String(article.content || "").toLowerCase();
  const category = String(article.category_name || "").toLowerCase();
  return terms.reduce((sum, term) => sum + (title.includes(term) ? 5 : 0) +
    (category.includes(term) ? 3 : 0) + (content.includes(term) ? 1 : 0), 0);
}
function parseSearch(input = {}) {
  const q = String(input.q || "").trim();
  if (q.length > 100) throw new HttpError(400, "Search is too long");
  const page = Number(input.page || 1);
  if (!Number.isSafeInteger(page) || page < 1 || page > 100) throw new HttpError(400, "Invalid page");
  const categoryId = input.categoryID || input.categoryId ? id(input.categoryID || input.categoryId) : null;
  return { q, page, categoryId, terms: words(q) };
}
module.exports = { words, scoreArticle, parseSearch };
