
const API_BASE = window.SUPPORT_HUB.API_URL;
let csrfToken = null;
let currentUser = null;
let turnstilePromise = null;
const turnstileWidgets = new Map();

async function api(path, options = {}) {
  const method = (options.method || "GET").toUpperCase();
  const headers = { ...(options.headers || {}) };

  if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
    if (!csrfToken) {
      const response = await fetch(API_BASE + "/auth/csrf", {
        credentials: "include"
      });
      if (!response.ok) {
        throw new Error("Unable to initialize security token");
      }
      csrfToken = (await response.json()).csrfToken;
    }

    headers["X-CSRF-Token"] = csrfToken;
  }

  if (options.body && typeof options.body === "object") {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(API_BASE + path, {
    ...options,
    method,
    headers,
    credentials: "include",
    body: options.body && typeof options.body === "object"
      ? JSON.stringify(options.body)
      : options.body
  });

  const result = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(result.error || "Request failed");
  }

  return result;
}

async function getCurrentUser() {
  try {
    const result = await api("/auth/me");
    currentUser = result.user;
  } catch {
    currentUser = null;
  }
  return currentUser;
}

async function renderNavigation() {
  const nav = document.querySelector("#navigation");
  if (!nav) return;

  const user = await getCurrentUser();
  nav.replaceChildren();

  function addLink(text, href) {
    const link = document.createElement("a");
    link.href = href;
    link.textContent = text;
    nav.appendChild(link);
  }

  addLink("Home", "index.html");
  addLink("Articles", "articles.html");

  if (!user) {
    addLink("Login", "login.html");
    return;
  }

  if (["author", "admin"].includes(user.role)) {
    addLink("My Articles", "editor.html");
  }

  if (["editor", "admin"].includes(user.role)) {
    addLink("Review", "review.html");
    addLink("Analytics", "analytics.html");
  }

  const logout = document.createElement("button");
  logout.textContent = "Logout";
  logout.className = "secondary";
  logout.addEventListener("click", async () => {
    try {
      await api("/auth/logout", { method: "POST" });
      csrfToken = null;
      window.location.href = "index.html";
    } catch (error) {
      alert(error.message);
    }
  });
  nav.appendChild(logout);
}

async function requireRole(roles) {
  const user = await getCurrentUser();

  if (!user || !roles.includes(user.role)) {
    alert("You do not have permission to access this page.");
    window.location.replace("login.html");
    throw new Error("Access denied");
  }

  return user;
}

function loadTurnstile() {
  if (!window.SUPPORT_HUB.TURNSTILE_SITE_KEY) {
    return Promise.resolve(null);
  }

  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (turnstilePromise) return turnstilePromise;

  turnstilePromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src =
      "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.onload = () => {
      const check = () => {
        if (window.turnstile) resolve(window.turnstile);
        else setTimeout(check, 50);
      };
      check();
    };
    script.onerror = () => reject(new Error("Turnstile failed to load"));
    document.head.appendChild(script);
  });

  return turnstilePromise;
}

async function mountTurnstile(elementId) {
  const turnstile = await loadTurnstile();
  if (!turnstile) return;

  if (!turnstileWidgets.has(elementId)) {
    const widgetId = turnstile.render("#" + elementId, {
      sitekey: window.SUPPORT_HUB.TURNSTILE_SITE_KEY
    });
    turnstileWidgets.set(elementId, widgetId);
  }
}

function getTurnstileToken(elementId) {
  if (!window.SUPPORT_HUB.TURNSTILE_SITE_KEY) return "";
  const widgetId = turnstileWidgets.get(elementId);
  return widgetId === undefined
    ? ""
    : window.turnstile.getResponse(widgetId);
}

function resetTurnstile(elementId) {
  const widgetId = turnstileWidgets.get(elementId);
  if (widgetId !== undefined && window.turnstile) {
    window.turnstile.reset(widgetId);
  }
}

async function initializeAuthenticationForms() {
  const loginForm = document.querySelector("#login-form");
  const registerForm = document.querySelector("#register-form");
  const message = document.querySelector("#auth-message");

  if (registerForm) {
    try {
      await mountTurnstile("registration-turnstile");
    } catch (error) {
      message.textContent = error.message;
    }
  }

  if (loginForm) {
    loginForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const data = new FormData(loginForm);

      try {
        message.textContent = "Signing in...";

        const result = await api("/auth/login", {
          method: "POST",
          body: {
            email: data.get("email"),
            password: data.get("password")
          }
        });

        csrfToken = null;
        window.location.href =
          result.user.role === "editor" ? "review.html" :
          result.user.role === "admin" ? "analytics.html" :
          "editor.html";
      } catch (error) {
        message.textContent = error.message;
      }
    });
  }

  if (registerForm) {
    registerForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const data = new FormData(registerForm);

      try {
        message.textContent = "Creating account...";

        await api("/auth/register", {
          method: "POST",
          body: {
            name: data.get("name"),
            email: data.get("email"),
            password: data.get("password"),
            turnstileToken: getTurnstileToken(
              "registration-turnstile"
            )
          }
        });

        message.textContent =
          "Registration successful. You can now log in.";
        registerForm.reset();
      } catch (error) {
        message.textContent = error.message;
      } finally {
        resetTurnstile("registration-turnstile");
      }
    });
  }
}

document.addEventListener("DOMContentLoaded", () => {
  renderNavigation();
  initializeAuthenticationForms();
});

window.api = api;
window.requireRole = requireRole;
window.mountTurnstile = mountTurnstile;
window.getTurnstileToken = getTurnstileToken;
window.resetTurnstile = resetTurnstile;

