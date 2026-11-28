// Search & Analytics dashboard (owner: Nermeen).
// Reads the Search & Analytics Service: overview (Neon), live counters (DynamoDB),
// exports (S3). Only reviewer, editor (temporary) and admin; the backend enforces this too.
// All text is set with textContent (never innerHTML) so search terms cannot inject HTML.
// Layout uses only classes that already exist in css/style.css (panel, two-columns,
// table-wrap, stat-card, status, empty-state, loading, muted), so the page matches the
// rest of the site and no CSS or HTML file needs to change.

// Only run on the analytics page itself ("/analytics" on Cloudflare, "/analytics.html" locally).
// Other pages (e.g. articles.html) may load this script; there it must do nothing,
// so authors and readers are never redirected away from pages they are allowed to use.
function isAnalyticsPage() {
  return /\/analytics(\.html)?\/?$/.test(window.location.pathname);
}

// Small helper: create an element with optional text and class.
function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined && text !== null) node.textContent = text;
  if (className) node.className = className;
  return node;
}

// A white panel (same look as the three panels in analytics.html).
// "hint" is an optional grey line under the heading explaining the section.
function makePanel(title, hint) {
  const panel = el("section", null, "panel");
  panel.appendChild(el("h2", title));
  if (hint) panel.appendChild(el("p", hint, "muted"));
  const body = el("div");
  panel.appendChild(body);
  return { panel, body };
}

// Two panels side by side (stacks into one column on small screens).
function makeRow(container, ...panels) {
  const row = el("div", null, "two-columns");
  // Same width as the full-width panels (.panel has max-width 1100px), so edges line up.
  row.style.maxWidth = "1100px";
  row.style.margin = "0 auto";
  panels.forEach(item => row.appendChild(item.panel));
  container.appendChild(row);
}

// Grey dashed box used across the site when there is nothing to show.
function showEmpty(parent, text) {
  parent.replaceChildren(el("div", text, "empty-state"));
}

// Table in the site's style. Each row is an array of values; a value can also be
// a DOM node (used for the sentiment badges).
function showTable(parent, headings, rows, emptyText) {
  parent.replaceChildren();
  if (!rows || !rows.length) {
    showEmpty(parent, emptyText);
    return;
  }
  const wrap = el("div", null, "table-wrap");
  const table = el("table");
  const head = el("thead");
  const headRow = el("tr");
  headings.forEach(text => headRow.appendChild(el("th", text)));
  head.appendChild(headRow);
  const body = el("tbody");
  rows.forEach(values => {
    const row = el("tr");
    values.forEach(value => {
      const cell = el("td");
      if (value instanceof Node) cell.appendChild(value);
      else cell.textContent = value;
      row.appendChild(cell);
    });
    body.appendChild(row);
  });
  table.append(head, body);
  wrap.appendChild(table);
  parent.appendChild(wrap);
}

function badge(text) {
  return el("span", text, "status");
}

async function loadLiveCounters(termsBody, articlesBody) {
  termsBody.replaceChildren(el("p", "Loading live counters", "loading"));
  articlesBody.replaceChildren(el("p", "Loading live counters", "loading"));
  try {
    const live = await api("/analytics/live-counters");
    if (!live.available) {
      const text = "Live counters are unavailable right now (DynamoDB not reachable).";
      showEmpty(termsBody, text);
      showEmpty(articlesBody, text);
      return;
    }
    showTable(
      termsBody,
      ["Term", "Searches", "No results"],
      live.terms.map(item => [item.term, item.searches, item.zeroResults]),
      "No searches counted yet."
    );
    showTable(
      articlesBody,
      ["Article ID", "Views"],
      live.articles.map(item => [item.articleId, item.views]),
      "No article views counted yet."
    );
  } catch (error) {
    showEmpty(termsBody, error.message);
    showEmpty(articlesBody, error.message);
  }
}

async function loadExports(listBox) {
  listBox.replaceChildren(el("p", "Loading exports", "loading"));
  try {
    const result = await api("/analytics/exports");
    if (!result.exports.length) {
      showEmpty(listBox, "No exports yet.");
      return;
    }
    const rows = result.exports.map(item => {
      const name = typeof item === "string" ? item : item.name;
      const link = el("a", name);
      link.href = apiBaseFor("/analytics") + "/analytics/exports/" + encodeURIComponent(name);
      return [link];
    });
    showTable(listBox, ["Export file"], rows, "No exports yet.");
  } catch (error) {
    showEmpty(listBox, error.message);
  }
}

async function initializeAnalytics() {
  if (!isAnalyticsPage()) return;

  const summary = document.getElementById("analytics-summary");

  if (!summary) return;

  const message = document.getElementById("analytics-message");
  const container = summary.closest("main") || document.body;

  // The role="status" box is styled by style.css, so this shows a tidy loading note.
  if (message) message.textContent = "Loading analytics...";

  try {
    await requireRole(["reviewer", "editor", "admin"]);

    const result = await api("/analytics/overview");

    if (message) message.textContent = "";

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
      const card = el("div", null, "stat-card");
      card.append(el("strong", value), el("span", label));
      summary.appendChild(card);
    });

    // Article Performance: the table already exists in analytics.html.
    const table = document.getElementById("article-performance");

    if (table) {
      if (!result.mostViewedArticles.length) {
        const row = el("tr");
        const cell = el("td", "No article views recorded yet.", "muted");
        cell.colSpan = 4;
        row.appendChild(cell);
        table.appendChild(row);
      }
      result.mostViewedArticles.forEach(article => {
        const row = el("tr");
        [
          article.title,
          article.views,
          article.helpful_votes,
          article.unhelpful_votes
        ].forEach(value => row.appendChild(el("td", value)));
        table.appendChild(row);
      });
    }

    // Popular Search Terms: the panel exists in analytics.html; fill it with a table.
    const searches = document.getElementById("popular-searches");

    if (searches) {
      showTable(
        searches,
        ["Term", "Searches"],
        result.popularSearchTerms.map(item => [item.term, item.count]),
        "No search activity recorded yet."
      );
    }

    // Activity over the last 7 days (full width).
    const activity = makePanel("Activity — Last 7 Days", "Searches, article views and votes per day.");
    showTable(
      activity.body,
      ["Day", "Searches", "Views", "Votes"],
      (result.dailyActivity || []).map(day => [day.day, day.searches, day.views, day.votes]),
      "No activity recorded yet."
    );
    container.appendChild(activity.panel);

    // Row: what readers look at vs. what they cannot find.
    const trending = makePanel("Trending This Week", "Most viewed articles in the last 7 days.");
    showTable(
      trending.body,
      ["Article", "Views (7 days)"],
      (result.trendingArticles || []).map(item => [item.title, item.views_last_7_days]),
      "No article views in the last 7 days."
    );

    const gaps = makePanel("Knowledge Gaps", "Searches that returned no articles.");
    showTable(
      gaps.body,
      ["Term", "Searches"],
      (result.knowledgeGaps || []).map(item => [item.term, item.count]),
      "No knowledge gaps found."
    );
    makeRow(container, trending, gaps);

    // Row: article quality from votes and written feedback.
    const poor = makePanel(
      "Poorly Rated Articles",
      "Articles with at least " + result.poorlyRatedMinVotes + " votes and a low helpfulness rate."
    );
    showTable(
      poor.body,
      ["Article", "Helpful", "Unhelpful / Total"],
      (result.poorlyRatedArticles || []).map(item => [
        item.title,
        item.helpfulness_rate + "%",
        item.unhelpful_votes + " / " + item.total_votes
      ]),
      "No poorly rated articles."
    );

    const sentiment = makePanel("Feedback Sentiment", "Written feedback analysed as positive, negative or neutral.");
    showTable(
      sentiment.body,
      ["Sentiment", "Comments"],
      (result.sentimentBreakdown || []).map(item => [badge(item.label), item.count]),
      "No analysed feedback yet."
    );
    makeRow(container, poor, sentiment);

    // Row: live DynamoDB counters, terms and articles side by side.
    const liveTerms = makePanel("Live Search Counters", "Top search terms from AWS DynamoDB.");
    const liveArticles = makePanel("Live View Counters", "Top viewed articles from AWS DynamoDB.");
    makeRow(container, liveTerms, liveArticles);
    loadLiveCounters(liveTerms.body, liveArticles.body);

    // CSV exports to S3 (full width).
    const exportsPanel = makePanel("CSV Exports (AWS S3)", "Save a snapshot of the analytics as a CSV file in S3.");
    const exportButton = el("button", "Export analytics to S3");
    exportButton.type = "button";
    const exportStatus = el("p", "", "message");
    exportStatus.setAttribute("role", "status");
    const exportList = el("div");
    exportList.style.marginTop = "16px";
    exportsPanel.body.append(exportButton, exportStatus, exportList);
    container.appendChild(exportsPanel.panel);

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