
// Cloudflare Pages Function:
// /api/* => one of four Vercel backend services.

const origins = {
  identity: "IDENTITY_ORIGIN",
  article: "ARTICLE_ORIGIN",
  editorial: "EDITORIAL_ORIGIN",
  search: "SEARCH_ANALYTICS_ORIGIN"
};

function targetService(path, method) {
  const route = path.slice(4);

  if (/^\/auth(?:\/|$)/.test(route)) {
    return "identity";
  }

  if (/^\/(?:csrf-token|reviews)(?:\/|$)/.test(route)) {
    return "editorial";
  }
  if (method === "POST" && /^\/articles\/\d+\/reviews$/.test(route)) {
    return "editorial";
  }
  if (
    (method === "PATCH" && /^\/articles\/\d+\/publication$/.test(route)) ||
    (method === "POST" && /^\/articles\/\d+\/flags$/.test(route))
  ) {
    return "editorial";
  }

  if (/^\/editorial(?:\/|$)/.test(route)) {
    return "editorial";
  }

  if (/^\/(?:public|analytics)(?:\/|$)/.test(route)) {
    return "search";
  }

  if (
    /^\/articles\/\d+\/(?:votes|feedback|view)$/.test(route)
  ) {
    return "search";
  }

  if (route === "/articles" && method === "GET") {
    return "search";
  }

  if (
    /^\/(?:articles|categories|versions|references)(?:\/|$)/.test(route)
  ) {
    return "article";
  }

  return null;
}

function errorJson(message, status) {
  return new Response(
    JSON.stringify({ error: message }),
    {
      status,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store"
      }
    }
  );
}

export async function onRequest({ request, env }) {
  const incoming = new URL(request.url);

  if (!incoming.pathname.startsWith("/api/")) {
    return errorJson("Not found", 404);
  }

  const service = targetService(
    incoming.pathname,
    request.method
  );

  if (!service) {
    return errorJson(
      "API route not configured",
      404
    );
  }

  const configured = env[origins[service]];

  if (!configured) {
    return errorJson(
      `${service} service not configured`,
      503
    );
  }

  let backend;

  try {
    backend = new URL(configured);

    if (
      backend.protocol !== "https:" ||
      backend.username ||
      backend.password ||
      backend.search ||
      backend.hash ||
      backend.pathname !== "/"
    ) {
      return errorJson(
        "Invalid backend configuration",
        503
      );
    }
  } catch {
    return errorJson(
      "Invalid backend configuration",
      503
    );
  }

  const destination = new URL(
    incoming.pathname + incoming.search,
    backend
  );

  const headers = new Headers(request.headers);

  for (const name of [
    "host",
    "connection",
    "x-forwarded-host",
    "x-forwarded-proto",
    "x-forwarded-for"
  ]) {
    headers.delete(name);
  }

  try {
    const response = await fetch(destination, {
      method: request.method,
      headers,
      body: ["GET", "HEAD"].includes(request.method)
        ? undefined
        : request.body,
      redirect: "manual"
    });

    const responseHeaders = new Headers(
      response.headers
    );

    for (const name of [
      "access-control-allow-origin",
      "access-control-allow-credentials",
      "access-control-allow-headers",
      "access-control-allow-methods"
    ]) {
      responseHeaders.delete(name);
    }

    responseHeaders.set(
      "Cache-Control",
      "no-store"
    );

    return new Response(response.body, {
      status: response.status,
      headers: responseHeaders
    });
  } catch (error) {
    console.error(
      "API gateway upstream failure",
      error
    );

    return errorJson(
      "Backend unavailable",
      502
    );
  }
}
