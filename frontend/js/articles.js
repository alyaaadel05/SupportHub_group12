
const articlesList = document.querySelector("#articles-list");
const articleSearch = document.querySelector("#article-search");
const articleQuery = document.querySelector("#article-query");
const categoryFilter = document.querySelector("#category-filter");
const articleMessage = document.querySelector("#article-message");

let pendingVote = null;

function makeElement(tag, text, className = "") {
  const element = document.createElement(tag);
  element.textContent = text;
  if (className) element.className = className;
  return element;
}

async function loadCategories() {
  const result = await api("/categories");

  result.categories.forEach((category) => {
    const option = document.createElement("option");
    option.value = category.id;
    option.textContent = category.name;
    categoryFilter.appendChild(option);
  });
}

async function loadArticles() {
  articleMessage.textContent = "Loading articles...";
  articlesList.replaceChildren();

  try {
    const params = new URLSearchParams();

    if (articleQuery.value.trim()) {
      params.set("q", articleQuery.value.trim());
    }

    if (categoryFilter.value) {
      params.set("category", categoryFilter.value);
    }

    const result = await api("/articles?" + params.toString());

    result.articles.forEach((article) => {
      const card = document.createElement("article");
      card.className = "article-card";

      const title = makeElement("h3", article.title);
      const category = makeElement(
        "p", "Category: " + article.category_name, "muted"
      );
      const content = makeElement("p", article.content);
      content.hidden = true;

      const viewButton = makeElement("button", "Read Article");
      let viewed = false;

      viewButton.addEventListener("click", async () => {
        content.hidden = !content.hidden;
        viewButton.textContent = content.hidden
          ? "Read Article"
          : "Hide Article";

        if (!viewed) {
          viewed = true;
          try {
            await api("/articles/" + article.id + "/view", {
              method: "POST"
            });
          } catch (error) {
            console.error(error.message);
          }
        }
      });

      const helpfulButton = makeElement("button", "Helpful");
      const notHelpfulButton = makeElement(
        "button", "Not Helpful", "secondary"
      );

      helpfulButton.addEventListener("click", () => {
        prepareVote(article.id, true);
      });

      notHelpfulButton.addEventListener("click", () => {
        prepareVote(article.id, false);
      });

      card.append(
        title, category, viewButton, content,
        helpfulButton, notHelpfulButton
      );

      articlesList.appendChild(card);
    });

    articleMessage.textContent = result.articles.length
      ? result.articles.length + " article(s) found."
      : "No published articles found.";
  } catch (error) {
    articleMessage.textContent = error.message;
  }
}

async function prepareVote(articleId, helpful) {
  pendingVote = { articleId, helpful };
  const voteBox = document.querySelector("#vote-box");

  if (!voteBox) return;

  voteBox.hidden = false;
  voteBox.scrollIntoView({ behavior: "smooth" });

  if (!window.SUPPORT_HUB.TURNSTILE_SITE_KEY) {
    await submitVote();
  }
}

async function submitVote() {
  if (!pendingVote) return;

  try {
    await api("/articles/" + pendingVote.articleId + "/feedback", {
      method: "POST",
      body: {
        helpful: pendingVote.helpful,
        turnstileToken: getTurnstileToken("vote-turnstile")
      }
    });

    articleMessage.textContent = "Thank you for your feedback!";
    pendingVote = null;
    document.querySelector("#vote-box").hidden = true;
  } catch (error) {
    articleMessage.textContent = error.message;
  } finally {
    resetTurnstile("vote-turnstile");
  }
}

async function initializeArticles() {
  if (!articlesList) return;

  const urlParams = new URLSearchParams(window.location.search);
  articleQuery.value = urlParams.get("q") || "";

  const voteBox = document.createElement("div");
  voteBox.id = "vote-box";
  voteBox.className = "panel";
  voteBox.hidden = true;

  voteBox.appendChild(
    makeElement("h3", "Confirm your feedback")
  );

  const challenge = document.createElement("div");
  challenge.id = "vote-turnstile";
  voteBox.appendChild(challenge);

  const voteButton = makeElement("button", "Submit Feedback");
  voteButton.addEventListener("click", submitVote);
  voteBox.appendChild(voteButton);

  articlesList.after(voteBox);

  try {
    await loadCategories();
    await loadArticles();
    await mountTurnstile("vote-turnstile");
  } catch (error) {
    articleMessage.textContent = error.message;
  }

  articleSearch.addEventListener("submit", (event) => {
    event.preventDefault();
    loadArticles();
  });

  categoryFilter.addEventListener("change", loadArticles);
}

initializeArticles();

