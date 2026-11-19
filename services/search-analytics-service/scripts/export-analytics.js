// Generates an analytics CSV from Neon and uploads it to the private S3 bucket.
// Run: node scripts/export-analytics.js
require("dotenv").config();
const pool = require("../db/pool");
const { exportAnalytics } = require("../services/exportService");

exportAnalytics()
  .then((result) => console.log("Analytics report exported:", result))
  .catch((error) => {
    console.error("Export failed:", error.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());