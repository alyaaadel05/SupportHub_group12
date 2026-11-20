// Search & Analytics dashboard (owner: Nermeen).
// Reads the Search & Analytics Service: overview (Neon), live counters (DynamoDB),
// exports (S3). Only reviewer, editor (temporary) and admin; the backend enforces this too.
// All text is set with textContent (never innerHTML) so search terms cannot inject HTML.

function addSection(container, title) {
  const section = document.createElement("section");
  section.className = "card";
  const heading = document.createElement("h2");
  heading.textContent = title;
  const body = document.createElement("div");
  section.append(heading, body);
  container.appendChild(section);
  return body;
}

function addLine(parent, text) {
  const line = document.createElement("p");
  line.textContent = text;
  parent.appendChild(line);
}

function showList(parent, items, format, emptyText) {
  parent.replaceChildren();
  if (!items || !items.length) {
    addLine(parent, emptyText);
    return;
  }
  items.forEach(item => addLine(parent, format(item)));
}

// Live counter items are shown generically ("term: login, searches: 3").
function describe(item) {
  return Object.entries(item)
    .filter(([key]) => key !== "pk" && key !== "updatedAt")
    .map(([key, value]) => key + ": " + value)
    .join(", ");
}

async function loadLiveCounters(body) {
  body.replaceChildren();
  try {
    const live = await api("/analytics/live-counters");
    if (!live.available) {
      addLine(body, "Live counters are unavailable right now (DynamoDB not reachable).");
      return;
    }
    addLine(body, "Top search terms:");
    live.terms.forEach(item => addLine(body, "• " + describe(item)));
    if (!live.terms.length) addLine(body, "• none yet");
    addLine(body, "Top viewed articles:");
    live.articles.forEach(item => addLine(body, "• " + describe(item)));
    if (!live.articles.length) addLine(body, "• none yet");
  } catch (error) {
    addLine(body, error.message);
  }
}

async function loadExports(listBox) {
  listBox.replaceChildren();
  try {
    const result = await api("/analytics/exports");
    if (!result.exports.length) {
      addLine(listBox, "No exports yet.");
      return;
    }
    result.exports.forEach(item => {
      const name = typeof item === "string" ? item : item.name;
      const link = document.createElement("a");
      link.textContent = name;
      link.href = apiBaseFor("/analytics") + "/analytics/exports/" + encodeURIComponent(name);
      const line = document.createElement("p");
      line.appendChild(link);
      listBox.appendChild(line);
    });
  } catch (error) {
    addLine(listBox, error.message);
  }
}

async function initializeAnalytics() {
  const summary = document.getElementById("analytics-summary");

  if (!summary) return;

  const message = document.getElementById("analytics-message");
  const container = summary.closest("main") || document.body;

  try {
    await requireRole(["reviewer", "editor", "admin"]);

    const result = await api("/analytics/overview");

    const stats = [
      ["Total Searches", result.totalSearches],
      ["Search Success Rate", result.searchSuccessRate + "%"],
      ["Zero-Result Searches", result.zeroResultSearches],
      ["Click-Through Rate", result.clickThroughRate + "%"],
      ["Total Article Views", result.totalArticleViews],
      ["Helpful Votes", result.helpfulVotes],
      ["Unhelpful Votes", result.unhelpfulVotes],
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
      addLine(searches, item.term + " — " + item.count + " searches");
    });

    if (!result.popularSearchTerms.length) {
      searches.textContent = "No search activity recorded yet.";
    }

    // Extra sections created by this script (analytics.html is not changed).
    showList(
      addSection(container, "Knowledge Gaps (searches with no results)"),
      result.knowledgeGaps,
      item => item.term + " — " + item.count + " searches with no results",
      "No knowledge gaps found."
    );

    showList(
      addSection(container, "Poorly Rated Articles"),
      result.poorlyRatedArticles,
      item => item.title + " — " + item.helpfulness_rate + "% helpful (" +
        item.unhelpful_votes + " unhelpful of " + item.total_votes + " votes)",
      "No poorly rated articles."
    );

    showList(
      addSection(container, "Feedback Sentiment"),
      result.sentimentBreakdown,
      item => item.label + " — " + item.count,
      "No analysed feedback yet."
    );

    loadLiveCounters(addSection(container, "Live Counters (AWS DynamoDB)"));

    const exportBody = addSection(container, "CSV Exports (AWS S3)");
    const exportButton = document.createElement("button");
    exportButton.type = "button";
    exportButton.textContent = "Export analytics to S3";
    const exportStatus = document.createElement("p");
    const exportList = document.createElement("div");
    exportBody.append(exportButton, exportStatus, exportList);

    exportButton.addEventListener("click", async () => {
      exportButton.disabled = true;
      exportStatus.textContent = "Exporting...";
      try {
        const saved = await api("/analytics/exports", { method: "POST" });
        exportStatus.textContent = "Saved " + saved.name + " (" + saved.rows + " rows).";
        await loadExports(exportList);
      } catch (error) {
        exportStatus.textContent = error.message;
      } finally {
        exportButton.disabled = false;
      }
    });

    loadExports(exportList);
  } catch (error) {
    if (message) {
      message.textContent = error.message;
    }
  }
}

initializeAnalytics();