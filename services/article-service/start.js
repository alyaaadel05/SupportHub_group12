"use strict";

// Production entry point: load secrets from AWS Secrets Manager first,
// then start the HTTP API (default) or a background worker script.
//   node start.js                                -> API server
//   node start.js workers/articleEventConsumer.js -> worker with the same secrets
// server.js is unchanged and still works with "node server.js" + .env.

const path = require("node:path");
const { spawn } = require("node:child_process");
const { loadSecrets } = require("./config/secrets");

const DEFAULT_PORT = 3001;

async function main() {
  await loadSecrets();

  const script = process.argv[2];

  if (script) {
    const target = path.resolve(__dirname, script);

    if (!target.startsWith(__dirname + path.sep)) {
      throw new Error("Worker script must be inside the service folder");
    }

    // The child inherits process.env, including the loaded secrets.
    const child = spawn(process.execPath, [target], {
      stdio: "inherit",
      env: process.env
    });

    for (const signal of ["SIGINT", "SIGTERM"]) {
      process.on(signal, () => child.kill(signal));
    }

    child.on("exit", code => process.exit(code ?? 1));
    return;
  }

  const app = require("./server");
  const port = Number(process.env.PORT || DEFAULT_PORT);

  app.listen(port, () => {
    console.log(`article-service listening on ${port}`);
  });
}

main().catch(error => {
  console.error("Startup failed:", error.message);
  process.exit(1);
});
