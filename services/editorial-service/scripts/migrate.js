const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const pool = require("../db/pool");

const MIGRATIONS_DIR = path.join(__dirname, "..", "migrations");
const ADVISORY_LOCK_ID = 734221;
const ALLOWED_MIGRATION_TARGETS = new Map([
  ["supporthub-editorial-test-db", "editorial_test"],
  [
    "ep-falling-dream-b9en4011-pooler.c-7.eu-central-1.aws.neon.tech",
    "neondb"
  ]
]);

function assertSafeMigrationTarget() {
  const connectionString =
    process.env.DATABASE_URL_POOLED || process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error("No database connection string configured.");
  }

  let target;

  try {
    target = new URL(connectionString);
  } catch {
    throw new Error("Invalid database connection string.");
  }

  const expectedDatabase =
    ALLOWED_MIGRATION_TARGETS.get(target.hostname);

  const actualDatabase = decodeURIComponent(
    target.pathname.replace(/^\/+/, "")
  );

  const isSharedNeon =
    target.hostname === "ep-falling-dream-b9en4011-pooler.c-7.eu-central-1.aws.neon.tech" &&
    actualDatabase === "neondb";

  if (
    isSharedNeon &&
    (
      process.env.ALLOW_SHARED_NEON_MIGRATIONS !== "true" ||
      process.env.CONFIRM_SHARED_NEON_DATABASE !== "neondb"
    )
  ) {
    throw new Error(
      "Shared Neon migrations are blocked by default. " +
      "Only proceed after schema verification and explicit approval."
    );
  }

  if (!expectedDatabase || actualDatabase !== expectedDatabase) {
    throw new Error(
      "Migration blocked: database target is not on the approved allowlist."
    );
  }

  console.log(
    `Approved migration target: ${target.hostname}/${actualDatabase}`
  );
}

function checksum(content) {
  return crypto.createHash("sha256").update(content).digest("hex");
}

function migrationSql(content) {
  return content
    .replace(/^\s*BEGIN\s*;\s*/i, "")
    .replace(/\s*COMMIT\s*;\s*$/i, "")
    .trim();
}

async function main() {
  assertSafeMigrationTarget();

  const client = await pool.connect();
  let lockAcquired = false;

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS editorial_schema_migrations (
        migration_name TEXT PRIMARY KEY,
        checksum TEXT NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await client.query("SELECT pg_advisory_lock($1)", [ADVISORY_LOCK_ID]);
    lockAcquired = true;

    const files = fs.readdirSync(MIGRATIONS_DIR)
      .filter(name => /^\d+_[a-z0-9_]+\.sql$/i.test(name))
      .sort();

    const appliedResult = await client.query(
      "SELECT migration_name, checksum FROM editorial_schema_migrations"
    );

    const applied = new Map(
      appliedResult.rows.map(row => [row.migration_name, row.checksum])
    );

    let pending = 0;

    for (const file of files) {
      const content = fs.readFileSync(
        path.join(MIGRATIONS_DIR, file),
        "utf8"
      );
      const fileChecksum = checksum(content);

      if (applied.has(file)) {
        if (applied.get(file) !== fileChecksum) {
          throw new Error(
            `Checksum mismatch for applied migration ${file}. ` +
            "Do not modify an applied migration."
          );
        }

        console.log(`Already applied: ${file}`);
        continue;
      }

      console.log(`Applying: ${file}`);
      await client.query("BEGIN");

      try {
        await client.query(migrationSql(content));

        await client.query(
          `INSERT INTO editorial_schema_migrations
             (migration_name, checksum)
           VALUES ($1, $2)`,
          [file, fileChecksum]
        );

        await client.query("COMMIT");
        pending++;
        console.log(`Applied successfully: ${file}`);
      } catch (error) {
        await client.query("ROLLBACK");
        throw new Error(`Migration ${file} failed: ${error.message}`);
      }
    }

    console.log(
      pending === 0
        ? "Database schema is up to date."
        : `Successfully applied ${pending} migration(s).`
    );
  } finally {
    if (lockAcquired) {
      await client.query("SELECT pg_advisory_unlock($1)", [
        ADVISORY_LOCK_ID
      ]);
    }

    client.release();
    await pool.end();
  }
}

main().catch(error => {
  console.error("Migration runner failed:", error.message);
  process.exitCode = 1;
});
