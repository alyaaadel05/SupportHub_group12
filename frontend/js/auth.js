
// Route local API requests to the correct backend.
function apiBaseFor(path) {
  const origins = window.SUPPORT_HUB.API_ORIGINS;

  if (!origins) {
    return window.SUPPORT_HUB.API_URL;
  }

  const cleanPath = path.split("?")[0];
  if (/^\/articles\/\d+\/submissions$/.test(cleanPath)) {
  return origins.editorial;
}

  if (
    cleanPath === "/auth" ||
    cleanPath.startsWith("/auth/")
  ) {
    return origins.identity;
  }

  if (
    cleanPath === "/editorial" ||
    cleanPath.startsWith("/editorial/")
  ) {
    return origins.editorial;
  }

  if (
    cleanPath === "/analytics" ||
    cleanPath.startsWith("/analytics/")
  ) {
    return origins.search;
  }

  if (
    cleanPath === "/public" ||
    cleanPath.startsWith("/public/")
  ) {
    return origins.search;
  }

  if (
    /^\/articles\/\d+\/(votes|feedback|view)$/.test(cleanPath)
  ) {
    return origins.search;
  }

  return origins.article;
}

let csrfToken = null;
let currentUser = null;
let turnstilePromise = null;

const turnstileWidgets = new Map();

async function api(path, options = {}) {
  const method = (options.method || "GET").toUpperCase();
  const headers = { ...(options.headers || {}) };

  if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
    if (!csrfToken) {
      const csrfResponse = await fetch(
        apiBaseFor("/auth/csrf") + "/auth/csrf",
        {
          credentials: "include"
        }
      );

      if (!csrfResponse.ok) {
        throw new Error(
          "Unable to initialize security token"
        );
      }

      const csrfData = await csrfResponse.json();
      csrfToken = csrfData.csrfToken;
    }

    headers["X-CSRF-Token"] = csrfToken;
  }

  if (
    options.body &&
    typeof options.body === "object"
  ) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(
    apiBaseFor(path) + path,
    {
      ...options,
      method,
      headers,
      credentials: "include",
      body:
        options.body &&
        typeof options.body === "object"
          ? JSON.stringify(options.body)
          : options.body
    }
  );

  const result = await response
    .json()
    .catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      result.error || "Request failed"
    );
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

  const currentPage =
    window.location.pathname.split("/").pop() || "index.html";

  function addLink(text, href) {
    const link = document.createElement("a");
    link.href = href;
    link.textContent = text;
    if (href === currentPage) {
      link.setAttribute("aria-current", "page");
    }
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
      await api("/auth/logout", {
        method: "POST"
      });

      csrfToken = null;
      currentUser = null;

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
    alert(
      "You do not have permission to access this page."
    );

    window.location.replace("login.html");
    throw new Error("Access denied");
  }

  return user;
}

function loadTurnstile() {
  if (!window.SUPPORT_HUB.TURNSTILE_SITE_KEY) {
    return Promise.resolve(null);
  }

  if (window.turnstile) {
    return Promise.resolve(window.turnstile);
  }

  if (turnstilePromise) {
    return turnstilePromise;
  }

  turnstilePromise = new Promise(
    (resolve, reject) => {
      const script = document.createElement("script");

      script.src =
        "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

      script.onload = () => {
        const check = () => {
          if (window.turnstile) {
            resolve(window.turnstile);
          } else {
            setTimeout(check, 50);
          }
        };

        check();
      };

      script.onerror = () => {
        turnstilePromise = null;
        reject(new Error("Turnstile failed to load"));
      };

      document.head.appendChild(script);
    }
  );

  return turnstilePromise;
}

async function mountTurnstile(elementId) {
  const turnstile = await loadTurnstile();

  if (!turnstile) return;

  if (!turnstileWidgets.has(elementId)) {
    const widgetId = turnstile.render(
      "#" + elementId,
      {
        sitekey: window.SUPPORT_HUB.TURNSTILE_SITE_KEY
      }
    );

    turnstileWidgets.set(elementId, widgetId);
  }
}

function getTurnstileToken(elementId) {
  if (!window.SUPPORT_HUB.TURNSTILE_SITE_KEY) {
    return "";
  }

  const widgetId = turnstileWidgets.get(elementId);

  return widgetId === undefined
    ? ""
    : window.turnstile.getResponse(widgetId);
}

function resetTurnstile(elementId) {
  const widgetId = turnstileWidgets.get(elementId);

  if (
    widgetId !== undefined &&
    window.turnstile
  ) {
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
      if (message) {
        message.textContent = error.message;
      }
    }
  }

  if (loginForm) {
    loginForm.addEventListener(
      "submit",
      async (event) => {
        event.preventDefault();

        const data = new FormData(loginForm);

        try {
          if (message) {
            message.textContent = "Signing in...";
          }

          const result = await api("/auth/login", {
            method: "POST",
            body: {
              email: data.get("email"),
              password: data.get("password")
            }
          });

          csrfToken = result.csrfToken || null;
          currentUser = result.user;

          if (result.user.role === "editor") {
            window.location.href = "review.html";
          } else if (result.user.role === "admin") {
            window.location.href = "analytics.html";
          } else {
            window.location.href = "editor.html";
          }
        } catch (error) {
          if (message) {
            message.textContent = error.message;
          }
        }
      }
    );
  }

  if (registerForm) {
    registerForm.addEventListener(
      "submit",
      async (event) => {
        event.preventDefault();

        const data = new FormData(registerForm);

        try {
          if (message) {
            message.textContent = "Creating account...";
          }

          await api("/auth/register", {
            method: "POST",
            body: {
              fullName: data.get("name"),
              email: data.get("email"),
              password: data.get("password"),
              turnstileToken:
                getTurnstileToken("registration-turnstile")
            }
          });

          if (message) {
            message.textContent =
              "Registration successful. You can now log in.";
          }

          registerForm.reset();
        } catch (error) {
          if (message) {
            message.textContent = error.message;
          }
        } finally {
          resetTurnstile("registration-turnstile");
        }
      }
    );
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
