const { httpError } = require("./articleService");
async function relatedQuestions(query) {
  if (typeof query !== "string" || query.trim().length < 2 || query.length > 100) {
    throw httpError(400, "Query must contain 2-100 characters");
  }
  const url = new URL("https://api.stackexchange.com/2.3/search/advanced");
  url.searchParams.set("site", "stackoverflow");
  url.searchParams.set("q", query.trim());
  url.searchParams.set("pagesize", "5");
  url.searchParams.set("order", "desc");
  url.searchParams.set("sort", "relevance");
  if (process.env.STACK_EXCHANGE_KEY) url.searchParams.set("key", process.env.STACK_EXCHANGE_KEY);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { Accept: "application/json" } });
    if (!response.ok) throw httpError(502, "Reference provider unavailable");
    const data = await response.json();
    if (!Array.isArray(data.items)) throw httpError(502, "Invalid reference response");
    // Return source links only; never insert answers or bodies into article content.
    return data.items.map(item => ({ title: item.title, url: item.link, source: "Stack Overflow", questionId: item.question_id }));
  } catch (e) { if (e.status) throw e; throw httpError(502, "Reference provider unavailable"); }
  finally { clearTimeout(timeout); }
}
module.exports = { relatedQuestions };
