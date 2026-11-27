"use strict";

// Editor dashboard additions (review.html):
//   - Outdated-content flags: list open flags, resolve with an explanation
//     (GET /api/editorial/flags, PATCH /api/flags/:id)
//   - Editorial history: status timeline of one article
//     (GET /api/articles/:id/history)
// All requests use the shared api() helper (session cookie + CSRF token).
// The backend enforces the reviewer role; this file only renders.
// Text is always inserted with textContent (never innerHTML).

(function () {
  function node(tag, text, className) {
    const element = document.createElement(tag);
    if (text !== undefined && text !== null) element.textContent = String(text);
    if (className) element.className = className;
    return element;
  }

  function when(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "" : date.toLocaleString();
  }

  async function loadFlags() {
    const box = document.getElementById("flag-list");
    const message = document.getElementById("flag-message");
    if (!box) return;

    box.replaceChildren(node("p", "Loading open flags", "loading"));

    try {
      const result = await window.api("/editorial/flags?limit=50");
      const flags = Array.isArray(result.flags) ? result.flags : [];
      box.replaceChildren();

      if (!flags.length) {
        box.appendChild(node("div", "No open outdated-content flags. 🎉", "empty-state"));
        return;
      }

      for (const flag of flags) {
        const item = node("div", null, "item");
        const head = node("div", null, "item-head");
        head.append(
          node("strong", flag.article?.title || `Article #${flag.article_id}`),
          node("span", "Open", "badge badge-warning")
        );
        if (flag.source === "search") {
          head.append(node("span", "Automatic (reader votes)", "badge"));
        }
        item.append(
          head,
          node("p", flag.reason),
          node("p", `Flag #${flag.flag_id} · reported ${when(flag.created_at)}`, "item-meta")
        );

        const form = document.createElement("form");
        const id = `resolution-${flag.flag_id}`;
        const label = node("label", "Resolution (required)");
        label.htmlFor = id;
        const input = document.createElement("input");
        input.id = id;
        input.required = true;
        input.maxLength = 1000;
        input.placeholder = "What was updated or why no change is needed";
        const button = node("button", "Resolve flag");
        button.type = "submit";
        form.append(label, input, button);

        form.addEventListener("submit", async event => {
          event.preventDefault();
          button.disabled = true;
          try {
            await window.api(`/flags/${encodeURIComponent(flag.flag_id)}`, {
              method: "PATCH",
              body: { resolution: input.value.trim() }
            });
            message.textContent = `Flag #${flag.flag_id} resolved.`;
            await loadFlags();
          } catch (error) {
            message.textContent = error.message;
            button.disabled = false;
          }
        });

        item.appendChild(form);
        box.appendChild(item);
      }
    } catch (error) {
      box.replaceChildren(node("div", error.message, "empty-state"));
    }
  }

  function setupHistory() {
    const form = document.getElementById("history-form");
    const box = document.getElementById("history-result");
    if (!form || !box) return;

    form.addEventListener("submit", async event => {
      event.preventDefault();
      const articleId = document.getElementById("history-article-id").value.trim();

      if (!/^[1-9]\d{0,15}$/.test(articleId)) {
        box.replaceChildren(node("div", "Enter a valid article ID.", "empty-state"));
        return;
      }

      box.replaceChildren(node("p", "Loading history", "loading"));

      try {
        const result = await window.api(`/articles/${articleId}/history`);
        const events = Array.isArray(result.history) ? result.history : [];
        box.replaceChildren();

        if (!events.length) {
          box.appendChild(node("div", "No editorial events recorded for this article.", "empty-state"));
          return;
        }

        const list = node("ol", null, "timeline");
        for (const item of events) {
          const entry = document.createElement("li");
          entry.append(
            node("strong", `${item.previous_status} → ${item.new_status}`),
            node("div", `by user #${item.actor_id} · ${when(item.created_at)}`, "item-meta")
          );
          list.appendChild(entry);
        }
        box.appendChild(list);
      } catch (error) {
        box.replaceChildren(node("div", error.message, "empty-state"));
      }
    });
  }

  document.addEventListener("DOMContentLoaded", async () => {
    if (!document.getElementById("flag-list")) return;
    try {
      // Same role rule as editorial.js; the backend enforces it as well.
      const me = await window.api("/auth/me");
      if (!["editor", "admin", "reviewer"].includes(me.user?.role)) return;
    } catch {
      return;
    }
    setupHistory();
    loadFlags();
  });
})();
