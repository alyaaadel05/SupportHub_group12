// Recovery job for feedback sentiment.
// Re-classifies written feedback whose sentiment is 'pending' (never stored,
// e.g. the update failed or the process stopped after the insert) or
// 'unavailable' (analysis failed). Feedback text is never changed or deleted.
// Safe to run more than once (only touches pending/unavailable rows).
// Run: node scripts/reprocess-sentiment.js            (local .env)
//      node start.js scripts/reprocess-sentiment.js   (container: secrets loaded first)
require("dotenv").config();
const pool = require("../db/pool");
const { reprocessSentiment } = require("../services/feedbackService");

reprocessSentiment(Number(process.argv[2]) || 100)
  .then(result => { console.log("Sentiment reprocess:", JSON.stringify(result)); process.exitCode = result.failed ? 1 : 0; })
  .catch(error => { console.error("Sentiment reprocess error:", error.message); process.exitCode = 1; })
  .finally(() => pool.end());
