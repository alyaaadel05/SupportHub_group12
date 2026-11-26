"use strict";

// Vercel -> remote Floci through Cloudflare Tunnel + Cloudflare Access.
// When FLOCI_ACCESS_CLIENT_ID and FLOCI_ACCESS_CLIENT_SECRET are set, every AWS
// SDK request carries the Access service-token headers, so the Floci hostname is
// reachable only by holders of the token (Floci itself is never exposed directly).
// Without the variables this is a no-op (local Docker / ECS tasks on the Floci network).
// The headers are added after SigV4 signing (deserialize step), so they are not part
// of the signature and Cloudflare may strip them at the edge without breaking requests.
function withFlociAccess(client, env = process.env) {
  const id = env.FLOCI_ACCESS_CLIENT_ID;
  const secret = env.FLOCI_ACCESS_CLIENT_SECRET;
  if (!id || !secret) return client;
  client.middlewareStack.add(
    next => async args => {
      if (args.request && args.request.headers) {
        args.request.headers["cf-access-client-id"] = id;
        args.request.headers["cf-access-client-secret"] = secret;
      }
      return next(args);
    },
    { step: "deserialize", name: "flociAccessHeaders", override: true }
  );
  return client;
}

module.exports = { withFlociAccess };
