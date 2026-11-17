
const local = ["localhost", "127.0.0.1"].includes(
  window.location.hostname
);

window.SUPPORT_HUB = {
  API_URL: "/api",

  API_ORIGINS: local ? {
    identity: "http://127.0.0.1:3003/api",
    article: "http://127.0.0.1:3001/api",
    editorial: "http://127.0.0.1:3002/api",
    search: "http://127.0.0.1:3004/api"
  } : null,

  TURNSTILE_SITE_KEY: ""
};
