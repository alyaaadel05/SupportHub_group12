const hostname = window.location.hostname;

const local = [
  "localhost",
  "127.0.0.1",
  "100.111.138.123"
].includes(hostname);

const backendHost =
  hostname === "localhost" ||
  hostname === "127.0.0.1"
    ? "127.0.0.1"
    : hostname;

window.SUPPORT_HUB = {
  API_URL: "/api",

  API_ORIGINS: null,

  TURNSTILE_SITE_KEY:
    ["localhost", "127.0.0.1", "100.111.138.123"].includes(hostname)
      ? "1x00000000000000000000AA"
      : "0x4AAAAAAGKXHCV-7y1Q1mjv"
};