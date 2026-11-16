
function el(tag, text, className = "") {
  const node = document.createElement(tag);
  node.textContent = text;
  if (className) node.className = className;
  return node;
}

function actionButton(label, action, className = "") {
  const button = el("button", label, className);
  button.type = "button";
  button.addEventListener("click", action);
  return button;
}

function showMessage(id, text) {
  document.getElementById(id).textContent = text;
}

async function loadEditorCategories() {
  const select = document.getElementById("article-category");
  const result = await api("/categories");

  select.replaceChildren();
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Choose a category";
  select.appendChild(placeholder);

  result.categories.forEach(category => {
    const option = document.createElement("option");
    option.value = category.id;
    option.textContent = category.name;
    select.appendChild(option);
  });
}

function resetEditorForm() {
  document.getElementById("article-form").reset();
  document.getElementById("article-id").value = "";
}

async function loadMyArticles() {
  const container = document.getElementById("my-articles");
  container.replaceChildren();

  const result = await api("/articles/mine");

  if (!result.articles.length) {
    container.appendChild(el("p", "You haven't created any articles yet."));
  }

  for (const article of result.articles) {
    const card = el("article", "", "article-card");
    card.appendChild(el("h3", article.title));
    card.appendChild(el("p", "Status: " + article.status, "status"));

    if (article.review_comment) {
      card.appendChild(
        el("p", "Review: " + article.review_comment)
      );
    }

    if (["draft", "rejected", "outdated"].includes(article.status)) {
      card.appendChild(actionButton("Edit", () => {
        document.getElementById("article-id").value = article.id;
        document.getElementById("article-title").value = article.title;
        document.getElementById("article-category").value =
          article.category_id;
        document.getElementById("article-content").value =
          article.content;

        window.scrollTo({ top: 0, behavior: "smooth" });
      }));

      card.appendChild(actionButton("Submit for Review", async () => {
        try {
          await api("/articles/" + article.id + "/submit", {
            method: "POST"
          });
          showMessage("editor-message", "Article submitted.");
          await loadMyArticles();
        } catch (error) {
          showMessage("editor-message", error.message);
        }
      }));
    }

    if (["draft", "rejected"].includes(article.status)) {
      card.appendChild(actionButton("Delete", async () => {
        if (!confirm("Delete this article permanently?")) return;

        try {
          await api("/articles/" + article.id, {
            method: "DELETE"
          });
          await loadMyArticles();
        } catch (error) {
          showMessage("editor-message", error.message);
        }
      }, "danger"));
    }

    container.appendChild(card);
  }
}

async function initializeEditor() {
  const form = document.getElementById("article-form");
  if (!form) return;

  await requireRole(["author", "admin"]);
  await loadEditorCategories();
  await loadMyArticles();

  form.addEventListener("submit", async event => {
    event.preventDefault();

    const id = document.getElementById("article-id").value;
    const body = {
      title: document.getElementById("article-title").value.trim(),
      categoryId: Number(
        document.getElementById("article-category").value
      ),
      content: document.getElementById("article-content").value.trim()
    };

    try {
      await api(id ? "/articles/" + id : "/articles", {
        method: id ? "PUT" : "POST",
        body
      });

      showMessage("editor-message", "Draft saved successfully.");
      resetEditorForm();
      await loadMyArticles();
    } catch (error) {
      showMessage("editor-message", error.message);
    }
  });

  document.getElementById("clear-form")
    .addEventListener("click", resetEditorForm);

  document.getElementById("category-form")
    .addEventListener("submit", async event => {
      event.preventDefault();

      try {
        await api("/categories", {
          method: "POST",
          body: {
            name: document.getElementById("category-name").value.trim()
          }
        });

        event.target.reset();
        await loadEditorCategories();
        showMessage("editor-message", "Category created.");
      } catch (error) {
        showMessage("editor-message", error.message);
      }
    });
}

async function loadReviewQueue() {
  const container = document.getElementById("review-list");
  container.replaceChildren();

  const result = await api("/editorial/queue");

  if (!result.articles.length) {
    container.appendChild(el("p", "No articles waiting for review."));
  }

  for (const article of result.articles) {
    const card = el("article", "", "article-card");

    card.appendChild(el("h3", article.title));
    card.appendChild(el("p", "Author: " + article.author_name));
    card.appendChild(el("p", "Category: " + article.category_name));
    card.appendChild(el("p", article.content));

    card.appendChild(actionButton("Approve", async () => {
      try {
        await api("/editorial/" + article.id + "/approve", {
          method: "POST"
        });
        await loadReviewQueue();
        await loadPublishedArticles();
      } catch (error) {
        showMessage("review-message", error.message);
      }
    }));

    card.appendChild(actionButton("Reject", async () => {
      const comment = prompt("Reason for rejection:");
      if (!comment || !comment.trim()) return;

      try {
        await api("/editorial/" + article.id + "/reject", {
          method: "POST",
          body: { comment: comment.trim() }
        });
        await loadReviewQueue();
      } catch (error) {
        showMessage("review-message", error.message);
      }
    }, "danger"));

    container.appendChild(card);
  }
}

async function loadPublishedArticles() {
  const container = document.getElementById("published-list");
  container.replaceChildren();

  const result = await api("/editorial/published");

  if (!result.articles.length) {
    container.appendChild(el("p", "No published articles yet."));
  }

  for (const article of result.articles) {
    const card = el("article", "", "article-card");
    card.appendChild(el("h3", article.title));

    card.appendChild(actionButton("Flag as Outdated", async () => {
      const comment = prompt("Why is this article outdated?");
      if (!comment || !comment.trim()) return;

      try {
        await api("/editorial/" + article.id + "/flag", {
          method: "POST",
          body: { comment: comment.trim() }
        });
        await loadPublishedArticles();
      } catch (error) {
        showMessage("review-message", error.message);
      }
    }, "secondary"));

    container.appendChild(card);
  }
}

async function initializeReview() {
  if (!document.getElementById("review-list")) return;

  await requireRole(["editor", "admin"]);
  await loadReviewQueue();
  await loadPublishedArticles();
}

initializeEditor().catch(error => {
  const message = document.getElementById("editor-message");
  if (message) message.textContent = error.message;
});

initializeReview().catch(error => {
  const message = document.getElementById("review-message");
  if (message) message.textContent = error.message;
});

