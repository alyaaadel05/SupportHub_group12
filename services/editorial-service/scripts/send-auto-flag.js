"use strict";

// Local test tool: sends POST /internal/auto-flags exactly as Search Service
// will (signed with the shared service secret), to check the endpoint before
// the Search side is ready. Run inside the Editorial container so the secret
// is loaded from Secrets Manager:
//
//   docker exec -e ARTICLE_ID=1 -e UNHELPFUL=6 -e TOTAL=8 \
//     supporthub-int-editorial node start.js scripts/send-auto-flag.js
//
// Add -e SENDER=article-service to see a wrong sender rejected (401).

const { signedHeaders } = require("../services/serviceClient");

async function main() {
  const body = JSON.stringify({
    articleId: Number(process.env.ARTICLE_ID),
    unhelpfulVotes: Number(process.env.UNHELPFUL),
    totalVotes: Number(process.env.TOTAL)
  });
  const path = "/internal/auto-flags";
  const sender = process.env.SENDER || "search-analytics-service";

  const response = await fetch(`http://127.0.0.1:${process.env.PORT || 3002}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...signedHeaders(sender, "POST", path, body)
    },
    body
  });

  console.log(`HTTP ${response.status}`);
  console.log(await response.text());
}

main().catch(error => {
  console.error(error.message);
  process.exit(1);
});
