# Owner promotion — one-time, approval-gated

This procedure promotes the **existing** production account to Owner and grants
permanent **Owner Premium**. It does not create, recreate or change the account:
the password, email, sessions and all personal data stay exactly as they are.

It is separate from the schema migration on purpose. Migration `0006` only adds
tables and columns; it grants nothing to anyone and names no email address.

Workflow: **Actions → Owner promotion (production)**
(`.github/workflows/owner-promotion.yml`, script `scripts/owner-promotion.mjs`).

## Safety model

| Guard                       | What it does                                                                                                         |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Manual only                 | `workflow_dispatch`; never on push, PR or schedule.                                                                  |
| Identified by internal id   | Input is the `user_…` id, which the Owner reads from their own signed-in Settings page.                              |
| Email confirmed by secret   | The email on record must equal the `OWNER_EXPECTED_EMAIL` environment secret. It is never printed; output is masked. |
| Preflight first             | Read-only. Shows the masked email, creation date, status and how many Owners exist.                                  |
| Typed confirmation + branch | `apply` needs `confirm` = `PROMOTE` and must run from `main`.                                                        |
| Approval                    | `apply` waits on the `production-database` environment (required reviewer).                                          |
| One-time                    | Refuses if any Owner already exists. The SQL itself re-checks this, so a repeat cannot promote someone else.         |
| Guarded writes              | Parameterised `INSERT … SELECT` statements that re-check id, email and active status inside the statement.           |
| Restore point               | Records a D1 Time Travel bookmark before writing. Restoring is never automatic.                                      |
| Audit                       | Writes an `owner.promote` entry to `admin_audit_log` with the workflow run link.                                     |

The repository is public, so Actions summaries are public. The workflow only
prints the opaque user id and a masked email (`p***********6@gmail.com`).

## Order of operations

1. **Schema PR** (`feat/owner-schema`) merged to `main`. It changes no
   application code, so the automatic deploy is a no-op for customers.
2. **Apply migration 0006**: Actions → _D1 migrations (production)_ →
   `preflight`, then `apply` with approval. See [D1_MIGRATIONS.md](D1_MIGRATIONS.md).
3. **Application PR** (`feat/owner-hq`) merged to `main`. Workers Builds deploys
   it. It needs the 0006 columns, which is why step 2 comes first.
4. **Promotion** (this document).
5. Sign in, open **👑 Goblin HQ**, add a passkey (your password is asked again),
   and confirm with it.

## One-time setup (GitHub UI)

Settings → Environments:

- `production-database-readonly` → add secret **`OWNER_EXPECTED_EMAIL`**
- `production-database` → add the same secret **`OWNER_EXPECTED_EMAIL`**

Value: the Owner account's email address. The existing D1 tokens are reused
(read token for preflight, migrate token for apply). Nothing new is needed in
Cloudflare.

## Running it

1. Sign in to https://pocketgoblin.org as the Owner account. Open
   **Settings → Account** and copy the **Account ID** (`user_…`).
2. Actions → **Owner promotion (production)** → Run workflow, branch `main`:
   action `preflight`, `user_id` = the id. Read the summary: the masked email,
   creation date and "Existing Owners: 0" must all be right.
3. Run again with action `apply`, the same `user_id`, `confirm` = `PROMOTE`.
   Approve the `production-database` review when it pauses.
4. The summary shows ✅ applied and ✅ verified.
5. Reload Pocket Goblin. **👑 Goblin HQ** appears in the navigation.

## Rollback and recovery

Nothing here is automatic; each is a deliberate, reviewed action.

- **Undo the promotion** (keeps all data), by hand with approval:

  ```sql
  UPDATE user_roles SET revoked_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
   WHERE user_id = '<user id>' AND role = 'owner' AND revoked_at IS NULL;
  UPDATE user_entitlements SET status = 'expired',
         ended_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
   WHERE user_id = '<user id>' AND entitlement = 'owner_premium' AND ended_at IS NULL;
  ```

  (`npx wrangler d1 execute pocket-goblin --remote --command "…"`)

- **Lost passkey**: delete the Owner's passkeys by hand, then sign in and add a
  new one (the password is asked again):

  ```sql
  DELETE FROM webauthn_credentials WHERE user_id = '<user id>';
  ```

- **Time Travel restore** rewinds the _whole_ database to the bookmark and
  loses every write since. Use only for a real emergency:
  `npx wrangler d1 time-travel restore pocket-goblin --bookmark=<bookmark>`.
