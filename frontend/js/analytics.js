// Search & Analytics dashboard (owner: Nermeen).
// Reads GET /api/analytics/overview from the Search & Analytics Service.
// Only reviewer, editor (temporary) and admin are allowed; the backend enforces this too.

async function initializeAnalytics() {
  const summary = document.getElementById("analytics-summary");

  if (!summary) return;

  const message = document.getElementById("analytics-message");

  try {
    await requireRole(["reviewer", "editor", "admin"]);

    const result = await api("/analytics/overview");

    const stats = [
      ["Total Searches", result.totalSearches],
      ["Search Success Rate", result.searchSuccessRate + "%"],
      ["Zero-Result Searches", result.zeroResultSearches],
      ["Click-Through Rate", result.clickThroughRate + "%"],
      ["Total Article Views", result.totalArticleViews],
      ["Helpfulness Rate", result.helpfulnessRate + "%"]
    ];

    stats.forEach(([label, value]) => {
      const card = document.createElement("div");
      card.className = "stat-card";

      const number = document.createElement("strong");
      number.textContent = value;

      const description = document.createElement("span");
      description.textContent = label;

      card.append(number, description);
      summary.appendChild(card);
    });

    const table = document.getElementById("article-performance");

    result.mostViewedArticles.forEach(article => {
      const row = document.createElement("tr");

      [
        article.title,
        article.views,
        article.helpful_votes,
        article.unhelpful_votes
      ].forEach(value => {
        const cell = document.createElement("td");
        cell.textContent = value;
        row.appendChild(cell);
      });

      table.appendChild(row);
    });

    const searches = document.getElementById("popular-searches");

    result.popularSearchTerms.forEach(item => {
      const row = document.createElement("p");
      row.textContent = item.term + " — " + item.count + " searches";
      searches.appendChild(row);
    });

    if (!result.popularSearchTerms.length) {
      searches.textContent = "No search activity recorded yet.";
    }
  } catch (error) {
    if (message) {
      message.textContent = error.message;
    }
  }
}

initializeAnalytics();