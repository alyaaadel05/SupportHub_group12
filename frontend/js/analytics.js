
async function initializeAnalytics() {
  const summary = document.getElementById("analytics-summary");
  if (!summary) return;

  const message = document.getElementById("analytics-message");

  try {
    await requireRole(["editor", "admin"]);

    const result = await api("/analytics/summary");

    const stats = [
      ["Total Articles", result.totalArticles],
      ["Published", result.publishedArticles],
      ["Pending Review", result.pendingArticles],
      ["Total Views", result.totalViews],
      ["Helpful Votes", result.helpfulVotes],
      ["Not Helpful Votes", result.notHelpfulVotes]
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

    result.articlePerformance.forEach(article => {
      const row = document.createElement("tr");

      [
        article.title,
        article.views,
        article.helpful,
        article.notHelpful
      ].forEach(value => {
        const cell = document.createElement("td");
        cell.textContent = value;
        row.appendChild(cell);
      });

      table.appendChild(row);
    });

    const searches = document.getElementById("popular-searches");

    result.popularSearches.forEach(item => {
      const row = document.createElement("p");
      row.textContent = item.term + " — " + item.count + " searches";
      searches.appendChild(row);
    });

    if (!result.popularSearches.length) {
      searches.textContent = "No search activity recorded yet.";
    }
  } catch (error) {
    message.textContent = error.message;
  }
}

initializeAnalytics();

