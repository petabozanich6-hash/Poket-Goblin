# D1 migrations

Placeholder directory for Cloudflare D1 SQL migrations.

**Do not create a database or run migrations yet.**

When the Floot schema is inventoried:

1. Export the original schema (see `docs/FLOOT_INVENTORY.md`).
2. Translate tables/indexes to SQLite-compatible SQL for D1.
3. Add numbered migration files here (e.g. `0001_init.sql`).
4. Uncomment the `[[d1_databases]]` block in `wrangler.toml` and provision.

Until then, this folder intentionally stays empty of migration SQL.
