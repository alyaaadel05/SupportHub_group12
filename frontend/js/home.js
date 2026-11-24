"use strict";

// Public home page: search box sends readers to the published-article search.
document.querySelector("#search-form").addEventListener("submit", event => {
  event.preventDefault();
  const text = document.querySelector("#search-input").value.trim();

  if (text) {
    window.location.href = "articles.html?q=" + encodeURIComponent(text);
  }
});
