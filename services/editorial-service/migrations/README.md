# Editorial Database Migrations

## Run migrations

From the Editorial Service directory:

    npm run db:migrate

The runner connects using DATABASE_URL_POOLED, falling back to
DATABASE_URL. Set DATABASE_SSL=false only for a local database
that does not use SSL.

## How the runner works

- Reads numbered SQL files from migrations/.
- Tracks applied migrations in editorial_schema_migrations.
- Stores a SHA-256 checksum for every applied migration.
- Uses a PostgreSQL advisory lock to prevent concurrent migration runs.
- Applies each pending migration in a transaction.
- Skips migrations already recorded with a matching checksum.
- Stops if an applied migration's checksum has changed.

## Adding a migration

1. Create the next numbered SQL file.
2. Use a descriptive lowercase filename.
3. Test against an isolated local database.
4. Run npm run db:migrate.
5. Run npm test.

Never edit an applied migration. Add a new migration for subsequent changes.

## Existing databases

For an existing database without migration history, verify its schema
before baselining migration history. Never run the migration runner
blindly against an existing database.

## Deployment safety

- Use an isolated local database for development.
- Never commit database credentials.
- Do not run Production migrations without an approved deployment plan.
- Local Floci verification does not establish Production SNS readiness.

### Shared Neon safety gate

The shared Neon Development database is blocked by default by the migration
runner. After independently verifying the existing schema and obtaining
approval, both environment variables below are required to permit migration:

    ALLOW_SHARED_NEON_MIGRATIONS=true
    CONFIRM_SHARED_NEON_DATABASE=neondb

Do not set these variables for routine tests. The isolated editorial_test
database remains the default migration target for development testing.
