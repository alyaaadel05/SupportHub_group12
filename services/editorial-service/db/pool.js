require("dotenv").config({ path: ".env.local" });

const { Pool } = require("pg");

const connectionString =
  process.env.DATABASE_URL_POOLED || process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL_POOLED or DATABASE_URL required");
}

const pool = new Pool({
  connectionString,
  ssl: process.env.DATABASE_SSL === "false"
    ? false
    : { rejectUnauthorized: true },
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
});

pool.on("error", err => {
  console.error("Database connection error:", err.message);
});

module.exports = pool;
