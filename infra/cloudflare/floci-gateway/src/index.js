// SupportHub Group 12 - Floci gateway (Cloudflare Worker on *.workers.dev).
//
// Vercel APIs -> https://<name>.<account>.workers.dev -> this Worker
//   -> Workers VPC Service binding FLOCI -> Cloudflare Tunnel (cloudflared on the
//   remote VM) -> http://floci:4566 on the VM's private Docker network.
// No domain and no public hostname for Floci are needed; the VM opens no ports.
//
// Authentication: the caller must send the service-token headers that the APIs'
// config/flociAccess.js already adds (cf-access-client-id / cf-access-client-secret).
// They are compared in constant time against the Worker secrets GATEWAY_CLIENT_ID /
// GATEWAY_CLIENT_SECRET (set with `wrangler secret put`), then removed before
// forwarding. Everything else (method, path, query, headers incl. the SigV4
// Authorization, body) is passed through unchanged. Floci still enforces IAM on the
// component key that signed the request.

const STRIP = ["cf-access-client-id", "cf-access-client-secret", "cf-connecting-ip", "cf-ipcountry", "cf-ray", "cf-visitor", "x-forwarded-for", "x-real-ip"];

async function sameSecret(a, b) {
  // Constant-time comparison via HMAC digests of equal length.
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", crypto.getRandomValues(new Uint8Array(32)), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const [x, y] = await Promise.all([crypto.subtle.sign("HMAC", key, enc.encode(String(a || ""))), crypto.subtle.sign("HMAC", key, enc.encode(String(b || "")))]);
  const u = new Uint8Array(x), v = new Uint8Array(y);
  let diff = 0;
  for (let i = 0; i < u.length; i++) diff |= u[i] ^ v[i];
  return diff === 0;
}

// Returns a short refusal reason, or "" when the request may be forwarded.
// Allow-lists come from env: ALLOWED_ACCESS_KEY_IDS (secret, comma separated - the component keys
// used by the Vercel APIs) and ALLOWED_SERVICES (default "s3,dynamodb,monitoring,sns").
export function authorizeAws(request, url, env) {
  if ([...url.searchParams.keys()].some(k => k.toLowerCase().startsWith("x-amz-"))) return "Presigned requests are not accepted";
  const auth = request.headers.get("authorization") || "";
  const m = auth.match(/^AWS4-HMAC-SHA256\s+Credential=([^/\s,]+)\/\d{8}\/[a-z0-9-]+\/([a-z0-9-]+)\/aws4_request/);
  if (!m) return "Signed AWS request required";
  const allowedKeys = String(env.ALLOWED_ACCESS_KEY_IDS || "").split(",").map(s => s.trim()).filter(Boolean);
  if (!allowedKeys.length || !allowedKeys.includes(m[1])) return "Access key not allowed";
  const allowedServices = String(env.ALLOWED_SERVICES || "s3,dynamodb,monitoring,sns").split(",").map(s => s.trim());
  // Optional per-key rules (secret KEY_SERVICE_RULES = "AKID=svc|svc;AKID2=svc"): when a key has a
  // rule, ONLY its listed services are allowed (e.g. Secrets Manager just for the Article key).
  const rule = String(env.KEY_SERVICE_RULES || "").split(";").map(s => s.trim()).find(s => s.startsWith(m[1] + "="));
  if (rule) {
    if (!rule.slice(m[1].length + 1).split("|").map(s => s.trim()).includes(m[2])) return "Service not allowed for this key";
  } else if (!allowedServices.includes(m[2])) return "Service not allowed";
  return "";
}

export async function handle(request, env) {
  const url = new URL(request.url);
  if (url.pathname === "/__gateway/health" && request.method === "GET") {
    return new Response(JSON.stringify({ status: "ok", service: "supporthub-floci-gateway" }), { headers: { "content-type": "application/json" } });
  }
  if (!env.GATEWAY_CLIENT_ID || !env.GATEWAY_CLIENT_SECRET || env.GATEWAY_CLIENT_SECRET.length < 32) {
    return new Response("Gateway not configured", { status: 503 });
  }
  const okId = await sameSecret(request.headers.get("cf-access-client-id"), env.GATEWAY_CLIENT_ID);
  const okSecret = await sameSecret(request.headers.get("cf-access-client-secret"), env.GATEWAY_CLIENT_SECRET);
  if (!okId || !okSecret) {
    return new Response("Forbidden", { status: 403 });
  }
  // Defence in depth behind the token: Floci accepts its default admin credentials and serves
  // unsigned S3 reads, so only SigV4-signed requests from allow-listed component access keys to
  // allow-listed services are forwarded (Floci IAM then limits each key to its own policy).
  const policy = authorizeAws(request, url, env);
  if (policy) return new Response(policy, { status: 403 });
  const headers = new Headers(request.headers);
  for (const h of STRIP) headers.delete(h);
  // Host and port come from the VPC Service configuration; the URL host only sets the Host header.
  const target = `http://${env.FLOCI_HOST || "floci"}:${env.FLOCI_PORT || "4566"}${url.pathname}${url.search}`;
  const init = { method: request.method, headers, redirect: "manual" };
  if (!["GET", "HEAD"].includes(request.method)) { init.body = request.body; init.duplex = "half"; }
  try {
    return await env.FLOCI.fetch(new Request(target, init));
  } catch {
    return new Response("Floci unreachable", { status: 502 });
  }
}

export default { fetch: handle };
