
require("dotenv").config();

const { Pool } = require("pg");

// Check that the database connection is configured
const connectionString = process.env.DATABASE_URL_POOLED || process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    "DATABASE_URL_POOLED or DATABASE_URL is required."
  );
}

// Create a PostgreSQL connection pool
const pool = new Pool({
  connectionString,

  ssl: {
    rejectUnauthorized: true
  },

  max: 5,

  idleTimeoutMillis: 30000,

  connectionTimeoutMillis: 10000
});

// Handle unexpected database connection errors
pool.on("error", (error) => {
  console.error(
    "Unexpected PostgreSQL pool error:",
    error.message
  );
});

// Export the pool for other backend files
module.exports = pool;

