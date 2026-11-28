
"use strict";

// ==========================================
// 1. HELPER FUNCTIONS
// ==========================================

function el(tag, text = "", className = "") {
  const node = document.createElement(tag);
  node.textContent = String(text ?? "");

  if (className) {
    node.className = className;
  }

  return node;
}

function actionButton(label, action, className = "") {
  const button = el("button", label, className);
  button.type = "button";
  button.addEventListener("click", action);
  return button;
}

function showMessage(id, text) {
  const element = document.getElementById(id);

  if (element) {
    element.textContent = text;
  }
}

// ==========================================
// 2. CATEGORIES
// ==========================================

async function loadEditorCategories() {
  const select = document.getElementById(
    "article-category"
  );

  if (!select) return;

  const result = await api("/categories");

  select.replaceChildren();

  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Choose a category";
  select.appendChild(placeholder);

  for (const category of result.categories || []) {
    const option = document.createElement("option");

    option.value = String(category.id);
    option.textContent = category.name;

    select.appendChild(option);
  }
}

// ==========================================
// 3. RESET FORM
// ==========================================

function resetEditorForm() {
  const form = document.getElementById("article-form");

  if (form) {
    form.reset();
  }

  const id = document.getElementById("article-id");

  if (id) {
    id.value = "";
  }

  clearDuplicateWarning();
}

// ==========================================
// 4. DUPLICATE WARNING
// ==========================================

function getDuplicateWarningBox() {
  let box = document.getElementById(
    "duplicate-warning"
  );

  if (box) return box;

  const form = document.getElementById("article-form");

  if (!form) return null;

  box = document.createElement("div");
  box.id = "duplicate-warning";
  box.className = "duplicate-warning";
  box.setAttribute("role", "status");
  box.hidden = true;

  form.appendChild(box);

  return box;
}

function clearDuplicateWarning() {
  const box = document.getElementById(
    "duplicate-warning"
  );

  if (box) {
    box.replaceChildren();
    box.hidden = true;
  }
}

function displayDuplicates(matches) {
  const box = getDuplicateWarningBox();

  if (!box) return;

  box.replaceChildren();
  box.hidden = false;

  box.appendChild(
    el("h3", "Potential Duplicate Articles")
  );

  box.appendChild(
    el(
      "p",
      "SupportHub found similar articles. " +
      "Review them before saving your draft."
    )
  );

  const list = document.createElement("ul");

  for (const match of matches) {
    const item = el(
      "li",
      match.title +
      " — " +
      Number(match.score).toFixed(2) +
      "% similarity"
    );

    list.appendChild(item);
  }

  box.appendChild(list);

  box.appendChild(
    el(
      "p",
      "You can revise the article or save it anyway."
    )
  );
}

async function checkArticleDuplicates(body, articleId) {
  const requestBody = {
    title: body.title,
    content: body.content,
    categoryId: body.categoryId
  };

  if (articleId) {
    requestBody.excludeId = Number(articleId);
  }

  const result = await api(
    "/articles/check-duplicates",
    {
      method: "POST",
      body: requestBody
    }
  );

  const matches = Array.isArray(result.matches)
    ? result.matches
    : [];

  if (!matches.length) {
    clearDuplicateWarning();
    return true;
  }

  displayDuplicates(matches);

  const descriptions = matches.map(match =>
    match.title +
    " — " +
    Number(match.score).toFixed(2) +
    "%"
  );

  return window.confirm(
    "Potential duplicate articles found:\n\n" +
    descriptions.join("\n") +
    "\n\nSave this article anyway?"
  );
}

// ==========================================
// 5. STACK EXCHANGE API INTEGRATION
// ==========================================

function clearReferenceResults() {
  const container = document.getElementById(
    "reference-results"
  );

  if (container) {
    container.replaceChildren();
  }

  showMessage("reference-message", "");
}

function safeStackOverflowUrl(value) {
  try {
    const url = new URL(value);

    if (
      url.protocol !== "https:" ||
      url.hostname !== "stackoverflow.com"
    ) {
      return null;
    }

    return url.href;
  } catch {
    return null;
  }
}

function displayRelatedQuestions(questions) {
  const container = document.getElementById(
    "reference-results"
  );

  if (!container) return;

  container.replaceChildren();

  if (!questions.length) {
    showMessage(
      "reference-message",
      "No related technical questions found."
    );
    return;
  }

  let displayed = 0;

  for (const question of questions) {
    const safeUrl = safeStackOverflowUrl(
      question.url
    );

    if (!safeUrl) continue;

    const card = document.createElement("article");
    card.className = "reference-card";

    const link = document.createElement("a");

    link.textContent = question.title;
    link.href = safeUrl;
    link.target = "_blank";
    link.rel = "noopener noreferrer";

    const source = el(
      "p",
      "Source: Stack Overflow"
    );

    card.append(link, source);
    container.appendChild(card);

    displayed++;
  }

  showMessage(
    "reference-message",
    displayed
      ? displayed + " related question(s) found."
      : "No valid reference links were returned."
  );
}

async function searchRelatedQuestions(query) {
  const keywords = query.trim();

  if (keywords.length < 2 || keywords.length > 100) {
    throw new Error(
      "Search keywords must contain 2 to 100 characters."
    );
  }

  const result = await api(
    "/articles/related-questions?q=" +
    encodeURIComponent(keywords)
  );

  displayRelatedQuestions(
    Array.isArray(result.questions)
      ? result.questions
      : []
  );
}

function initializeReferenceSearch() {
  const form = document.getElementById(
    "reference-form"
  );

  if (!form) return;

  const input = document.getElementById(
    "reference-query"
  );

  const button = document.getElementById(
    "reference-search-button"
  );

  form.addEventListener("submit", async event => {
    event.preventDefault();

    const query = input.value.trim();

    clearReferenceResults();

    try {
      button.disabled = true;
      button.textContent = "Searching...";

      showMessage(
        "reference-message",
        "Searching Stack Overflow..."
      );

      await searchRelatedQuestions(query);

    } catch (error) {
      showMessage(
        "reference-message",
        error.message
      );

    } finally {
      button.disabled = false;
      button.textContent = "Find Related Questions";
    }
  });

  // Authors can use their current article title
  // as a starting search if the keyword field is empty.
  input.addEventListener("focus", () => {
    if (input.value.trim()) return;

    const title = document.getElementById(
      "article-title"
    );

    if (title && title.value.trim()) {
      input.value = title.value.trim().slice(0, 100);
    }
  });
}

// ==========================================
// 6. LOAD MY ARTICLES
// ==========================================

// Display submission feedback inside the affected article card.
function showArticleNotice(card, message, type) {
  let notice = card.querySelector(".article-notice");

  if (!notice) {
    notice = el("p", "", "article-notice");
    card.appendChild(notice);
  }

  notice.className = "article-notice article-notice-" + type;
  notice.setAttribute("role", type === "error" ? "alert" : "status");
  notice.textContent = message;
}

async function loadMyArticles(submissionNotice = null) {
  const container = document.getElementById(
    "my-articles"
  );

  if (!container) return;

  container.replaceChildren();

  const result = await api("/articles/mine");
  const articles = result.articles || [];

  if (!articles.length) {
    container.appendChild(
      el("p", "You haven't created any articles yet.")
    );
    return;
  }

  for (const article of articles) {
    const card = el("article", "", "article-card");



    card.appendChild(el("h3", article.title));

    card.appendChild(
      el("p", "Status: " + article.status, "status")
    );

    if (article.review_comment) {
      card.appendChild(
        el("p", "Review: " + article.review_comment)
      );
    }
if (article.status === "draft") {
      // EDIT
      card.appendChild(
        actionButton("Edit", () => {
          document.getElementById(
            "article-id"
          ).value = article.id;

          document.getElementById(
            "article-title"
          ).value = article.title;

          document.getElementById(
            "article-category"
          ).value = article.category_id;

          document.getElementById(
            "article-content"
          ).value = article.content;

          clearDuplicateWarning();

          window.scrollTo({
            top: 0,
            behavior: "smooth"
          });
        })
      );

      // VERSION HISTORY
      card.appendChild(
        actionButton("Version History", () => {
          window.location.href =
            "versions.html?articleId=" +
            encodeURIComponent(article.id);
        }, "secondary")
      );

      // SUBMIT FOR REVIEW
      const submitButton = actionButton(
        "Submit for Review",
        async () => {
          submitButton.disabled = true;

          showArticleNotice(
            card,
            "Submitting article...",
            "pending"
          );

          try {
            await api(
              "/articles/" +
              encodeURIComponent(article.id) +
              "/submit",
              { method: "POST" }
            );
          } catch (error) {
            showArticleNotice(card, error.message, "error");
            submitButton.disabled = false;
            return;
          }

          showArticleNotice(
            card,
            "Article submitted for review.",
            "success"
          );

          try {
            await loadMyArticles({
              articleId: article.id,
              message: "Article submitted for review."
            });
          } catch (error) {
            if (!card.isConnected) {
              container.appendChild(card);
            }
            showArticleNotice(
              card,
              "Article submitted successfully. Refresh the page to update its status.",
              "success"
            );
          }
        }
      );

      card.appendChild(submitButton);
    } else {
      card.appendChild(
        actionButton("Version History", () => {
          window.location.href =
            "versions.html?articleId=" +
            encodeURIComponent(article.id);
        }, "secondary")
      );
    }

    // DELETE
   if (article.status === "draft") {
      card.appendChild(
        actionButton("Delete", async () => {
          if (
            !window.confirm(
              "Delete this article permanently?"
            )
          ) return;

          try {
            await api(
              "/articles/" +
              encodeURIComponent(article.id),
              {
                method: "DELETE"
              }
            );

            showMessage(
              "editor-message",
              "Article deleted successfully."
            );

            await loadMyArticles();

          } catch (error) {
            showMessage(
              "editor-message",
              error.message
            );
          }
        }, "danger")
      );
    }

    if (
      submissionNotice &&
      String(submissionNotice.articleId) === String(article.id)
    ) {
      showArticleNotice(
        card,
        submissionNotice.message,
        "success"
      );
    }

    container.appendChild(card);
  }
}

// ==========================================
// 7. INITIALIZE ARTICLE EDITOR
// ==========================================

async function initializeEditor() {
  const form = document.getElementById(
    "article-form"
  );

  if (!form) return;

  await requireRole(["author", "admin"]);

  await loadEditorCategories();
  await loadMyArticles();

  getDuplicateWarningBox();
  initializeReferenceSearch();

  // SAVE DRAFT
  form.addEventListener("submit", async event => {
    event.preventDefault();

    const id = document.getElementById(
      "article-id"
    ).value;

    const title = document.getElementById(
      "article-title"
    ).value.trim();

    const categoryValue = document.getElementById(
      "article-category"
    ).value;

    const content = document.getElementById(
      "article-content"
    ).value.trim();

    if (title.length < 3 || title.length > 200) {
      showMessage(
        "editor-message",
        "Title must contain 3 to 200 characters."
      );
      return;
    }

    if (!categoryValue) {
      showMessage(
        "editor-message",
        "Please select a category."
      );
      return;
    }

    if (
      content.length < 10 ||
      content.length > 20000
    ) {
      showMessage(
        "editor-message",
        "Content must contain 10 to 20000 characters."
      );
      return;
    }

    const body = {
      title,
      categoryId: Number(categoryValue),
      content
    };

    try {
      showMessage(
        "editor-message",
        "Checking for similar articles..."
      );

      const shouldSave = await checkArticleDuplicates(
        body,
        id
      );

      if (!shouldSave) {
        showMessage(
          "editor-message",
          "Save cancelled. Review the similar articles."
        );
        return;
      }

      const path = id
        ? "/articles/" + encodeURIComponent(id)
        : "/articles";

      const method = id ? "PATCH" : "POST";

      showMessage(
        "editor-message",
        "Saving article..."
      );

      await api(path, {
        method,
        body
      });

      showMessage(
        "editor-message",
        "Draft saved successfully."
      );

      resetEditorForm();

      await loadMyArticles();

    } catch (error) {
      showMessage(
        "editor-message",
        error.message
      );
    }
  });

  // CLEAR FORM
  const clearButton = document.getElementById(
    "clear-form"
  );

  if (clearButton) {
    clearButton.addEventListener(
      "click",
      resetEditorForm
    );
  }

  // CREATE CATEGORY
  const categoryForm = document.getElementById(
    "category-form"
  );

  if (categoryForm) {
    categoryForm.addEventListener(
      "submit",
      async event => {
        event.preventDefault();

        const categoryName = document.getElementById(
          "category-name"
        ).value.trim();

        if (
          categoryName.length < 2 ||
          categoryName.length > 80
        ) {
          showMessage(
            "editor-message",
            "Category name must contain 2 to 80 characters."
          );
          return;
        }

        try {
          await api("/categories", {
            method: "POST",
            body: {
              name: categoryName
            }
          });

          categoryForm.reset();

          await loadEditorCategories();

          showMessage(
            "editor-message",
            "Category created successfully."
          );

        } catch (error) {
          showMessage(
            "editor-message",
            error.message
          );
        }
      }
    );
  }
}

// ==========================================
// 8. EDITORIAL REVIEW QUEUE
// ==========================================

// Turns Editorial API errors into clear messages for editors.
// The backend still makes every decision; this only explains the result.
function friendlyEditorialError(status, serverMessage) {
  const detail = serverMessage ? " (" + serverMessage + ")" : "";

  switch (status) {
    case 400:
      return "Invalid input" + detail + ". Please check and try again.";
    case 401:
      return "Your session has expired. Please log in again.";
    case 403:
      return "You are not allowed to do this" + detail + ".";
    case 404:
      return "This article no longer exists. The list has been refreshed.";
    case 409:
      return "This article was already handled or has changed" + detail +
        ". The list has been refreshed.";
    case 429:
      return "Too many requests. Please wait a moment and try again.";
    case 502:
    case 503:
    case 504:
      return "A required service is temporarily unavailable. Please try again in a minute.";
    default:
      return serverMessage || "Editorial request failed (HTTP " + status + ").";
  }
}

// 404 or 409 means the list on screen is out of date (deleted article,
// or another editor already decided), so reload it.
function isStaleReviewError(error) {
  return error && (error.status === 404 || error.status === 409);
}

async function refreshReviewPage() {
  await loadReviewQueue();
  await loadApprovedReviews();
  await loadPublishedArticles();
}

// Comment limit matches the Editorial backend (services/http.js, 2000 characters).
const MAX_EDITORIAL_COMMENT = 2000;

async function submitEditorialDecision(articleId, decision, comments) {
  return editorialWrite(
    "/api/articles/" + encodeURIComponent(articleId) + "/reviews",
    "POST",
    { decision, comments }
  );
}

async function loadReviewQueue() {
  const container = document.getElementById("review-list");
  if (!container) return;

  container.replaceChildren();

  const result = await api("/reviews?status=pending");
  const reviews = Array.isArray(result.reviews) ? result.reviews : [];

  if (!reviews.length) {
    container.appendChild(el("p", "No articles waiting for review."));
    return;
  }

  for (const review of reviews) {
    const article = review.article || {};
    const articleId = review.article_id ?? article.id;
    const reviewId = review.review_id ?? review.id;

    if (articleId == null) continue;

    const card = el("article", "", "article-card");

    card.appendChild(
      el("h3", article.title || "Article #" + articleId)
    );

    card.appendChild(
      el("p", "Article ID: " + articleId + " | Review ID: " + reviewId)
    );

    card.appendChild(
      el("p", "Author ID: " + (article.author_id ?? review.submitted_by ?? "N/A"))
    );

    if (article.content) {
      card.appendChild(el("p", article.content));
    }

    let busy = false;

    async function decide(decision, comments) {
      if (busy) return;

      busy = true;
      approveButton.disabled = true;
      rejectButton.disabled = true;

      try {
        await submitEditorialDecision(articleId, decision, comments);

        showMessage("review-message", "Review " + decision + ".");

        await refreshReviewPage();
      } catch (error) {
        showMessage("review-message", error.message);

        if (isStaleReviewError(error)) {
          await refreshReviewPage();
        }
      } finally {
        busy = false;
        approveButton.disabled = false;
        rejectButton.disabled = false;
      }
    }

    const approveButton = actionButton("Approve", async () => {
      const comment = window.prompt(
        "Approve Article " + articleId + "? Optional comment for the author:",
        "Approved after editorial review."
      );

      if (comment === null) return; // Cancel pressed

      if (comment.trim().length > MAX_EDITORIAL_COMMENT) {
        showMessage(
          "review-message",
          "Comments must be " + MAX_EDITORIAL_COMMENT + " characters or fewer."
        );
        return;
      }

      await decide("approved", comment.trim());
    });

    const rejectButton = actionButton("Reject", async () => {
      const comment = window.prompt("Reason for rejection (required):");

      if (comment === null) return; // Cancel pressed

      if (!comment.trim()) {
        showMessage(
          "review-message",
          "A rejection reason is required. Article " + articleId + " was not rejected."
        );
        return;
      }

      if (comment.trim().length > MAX_EDITORIAL_COMMENT) {
        showMessage(
          "review-message",
          "The rejection reason must be " + MAX_EDITORIAL_COMMENT + " characters or fewer."
        );
        return;
      }

      await decide("rejected", comment.trim());
    }, "danger");

    card.append(approveButton, rejectButton);
    container.appendChild(card);
  }
}


async function editorialWrite(path, method, body) {
  const tokenResponse = await fetch("/api/csrf-token", {
    credentials: "include",
    cache: "no-store"
  });

  if (!tokenResponse.ok) {
    throw Error("Could not obtain Editorial CSRF token.");
  }

  const data = await tokenResponse.json();

  if (!/^[a-f0-9]{64}$/i.test(data.csrfToken || "")) {
    throw Error("Invalid CSRF token.");
  }

  const options = {
    method,
    credentials: "include",
    headers: {
      "X-CSRF-Token": data.csrfToken,
      "Content-Type": "application/json"
    }
  };

  if (body !== undefined) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(path, options);
  const result = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(
      friendlyEditorialError(
        response.status,
        result.error || result.message
      )
    );
    error.status = response.status;
    throw error;
  }

  return result;
}

async function loadApprovedReviews() {
  const container = document.getElementById("review-list");
  if (!container) return;

  const result = await api("/reviews?status=approved");
  const reviews = Array.isArray(result.reviews)
    ? result.reviews
    : [];

  const section = el("section");
  section.appendChild(
    el("h3", "Approved - Awaiting Publication")
  );

  const seen = new Set();
  let count = 0;

  for (const review of reviews) {
    const article = review.article || {};
    const articleId = Number(
      review.article_id ?? review.articleId ?? article.id
    );

    if (
      !Number.isSafeInteger(articleId) ||
      articleId <= 0 ||
      seen.has(articleId) ||
      article.status !== "approved"
    ) {
      continue;
    }

    seen.add(articleId);

    const card = el("article", "", "article-card");

    card.appendChild(
      el("h3", article.title || "Article #" + articleId)
    );

    card.appendChild(
      el("p", "Article ID: " + articleId)
    );

    const button = actionButton("Publish", async () => {
      const confirmed = window.confirm(
        "Publish Article " + articleId +
        "? It will become public and searchable."
      );

      if (!confirmed) return;

      button.disabled = true;

      try {
        const publication = await editorialWrite(
          "/api/articles/" + articleId + "/publication",
          "PATCH"
        );

        if (publication.status !== "published") {
          throw Error("Publication was not confirmed.");
        }

        showMessage(
          "review-message",
          "Article " + articleId + " published successfully."
        );

        await refreshReviewPage();
      } catch (error) {
        showMessage("review-message", error.message);

        if (isStaleReviewError(error)) {
          await refreshReviewPage();
        }
      } finally {
        button.disabled = false;
      }
    });

    card.appendChild(button);
    section.appendChild(card);
    count++;
  }

  if (count > 0) {
    container.appendChild(section);
  }
}

// ==========================================
// 9. PUBLISHED ARTICLES
// ==========================================

async function loadPublishedArticles() {
  const container = document.getElementById(
    "published-list"
  );

  if (!container) return;

  container.replaceChildren();

  const result = await api("/editorial/published");
  const articles = result.articles || [];

  if (!articles.length) {
    container.appendChild(
      el("p", "No published articles yet.")
    );
    return;
  }

  for (const article of articles) {
    const card = el("article", "", "article-card");

    card.appendChild(el("h3", article.title));

    card.appendChild(
      actionButton("Flag as Outdated", async () => {
        const comment = window.prompt(
          "Why is this article outdated?"
        );

        if (!comment || !comment.trim()) return;

        try {
          await editorialWrite(
            "/api/articles/" + encodeURIComponent(article.id) + "/flags",
            "POST",
            { reason: comment.trim() }
          );

          showMessage(
            "review-message",
            "Article flagged as outdated."
          );

          await loadPublishedArticles();

        } catch (error) {
          showMessage(
            "review-message",
            error.message
          );
        }
      }, "secondary")
    );

    container.appendChild(card);
  }
}

// ==========================================
// 10. INITIALIZE REVIEW PAGE
// ==========================================

async function initializeReview() {
  const reviewList = document.getElementById(
    "review-list"
  );

  if (!reviewList) return;

  await requireRole(["editor", "admin"]);

  await loadReviewQueue();
  await loadApprovedReviews();
  await loadPublishedArticles();
}

// ==========================================
// 11. START
// ==========================================

initializeEditor().catch(error => {
  showMessage(
    "editor-message",
    error.message
  );
});

initializeReview().catch(error => {
  showMessage(
    "review-message",
    error.message
  );
});
