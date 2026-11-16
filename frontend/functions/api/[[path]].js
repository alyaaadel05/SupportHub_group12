
export async function onRequest({ request, env }) {
  if (!env.BACKEND_ORIGIN) {
    return new Response(
      JSON.stringify({ error: "Backend not configured" }),
      {
        status: 503,
        headers: { "Content-Type": "application/json" }
      }
    );
  }

  const incomingUrl = new URL(request.url);
  const backendOrigin = new URL(env.BACKEND_ORIGIN);

  if (backendOrigin.protocol !== "https:") {
    return new Response("Invalid backend origin", {
      status: 500
    });
  }

  const destination = new URL(
    incomingUrl.pathname + incomingUrl.search,
    backendOrigin
  );

  const headers = new Headers(request.headers);
  headers.delete("host");
  headers.delete("x-forwarded-host");
  headers.delete("x-forwarded-proto");
  headers.delete("x-forwarded-for");

  const response = await fetch(destination.toString(), {
    method: request.method,
    headers,
    body: ["GET", "HEAD"].includes(request.method)
      ? undefined
      : request.body,
    redirect: "manual"
  });

  const responseHeaders = new Headers(response.headers);
  responseHeaders.delete("access-control-allow-origin");
  responseHeaders.delete("access-control-allow-credentials");

  return new Response(response.body, {
    status: response.status,
    headers: responseHeaders
  });
}

