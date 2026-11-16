# Companion client telemetry on heartbeats and API errors

Status: completed
Created: 2026-11-15
Updated: 2026-11-15

## Outcome and owners

Store the latest valid native client info on HostedMember through the existing
heartbeat update, and tag JSON route errors through one shared parser. Invalid
telemetry must not affect requests. Inspection confirmed that presence.ts writes
only receipt timestamps today and http.ts records only the request method.

## Design and boundaries

- Add five nullable member columns; no new table, timestamp, write path, query,
  transaction, external call, dependency, or change to native bearer auth.
- Preserve values on legacy/invalid heartbeats. Valid core fields replace all
  five values, clearing missing optional values. Existing member locking orders
  contact receipts and telemetry together.
- Apply the additive migration before Web. Old clients remain accepted; older
  Web tolerates the columns. Reverting Web does not require dropping columns.
- Client assertions are diagnostics only. Match the existing member metadata
  classification; account deletion removes the row, Settings exports vault data.
- Internal observability only: no member-visible UX or changelog entry.
- Work only on this branch; commit locally. Parent owns push, PR, CI, and the
  schema/privacy-eligible final ReviewGPT round.

## Tasks

1. Implement parser, heartbeat integration, error context, and additive migration.
2. Extend parser, route, presence, log, schema inventory, and deletion proof.
3. Update companion owner and privacy coverage docs; provide an operator query.
4. Run focused tests, web typecheck/lint, Prisma validation and migration proof,
   inspect complexity and privacy, then close this plan in the scoped commit.

## Verification

All final checks below returned EXIT=0. Long output is in ignored, path-redacted
logs under `.runtime/tmp/client-telemetry/`.

- `pnpm install --prefer-offline`
- `pnpm --dir apps/web prisma:generate`
- `pnpm build:workspace:incremental`
- `pnpm exec vitest run --config apps/web/vitest.config.ts --no-coverage apps/web/test/companion-client-info.test.ts apps/web/test/companion-presence.test.ts apps/web/test/companion-presence-route.test.ts apps/web/test/http.test.ts apps/web/test/hosted-onboarding-privacy-foundation-migration.test.ts apps/web/test/production-migration-guard.test.ts apps/web/test/hosted-account-data-service.test.ts apps/web/test/hosted-onboarding-member-store.test.ts apps/web/test/join-resume-page.test.ts apps/web/test/page-auth.test.ts` — 406 tests across 10 files.
- `pnpm --dir apps/web typecheck`
- `pnpm --dir apps/web prisma:validate`
- `pnpm --dir apps/web prisma:migrate:deploy` with `MURPH_PRISMA_SKIP_ENV_FILES=1`
  and an isolated loopback test database — all migrations applied, including
  `20261116010000_companion_client_info`; schema contract passed.
- `MURPH_TEST_POSTGRES_CONCURRENCY=1 pnpm exec vitest run --config apps/web/vitest.config.ts --no-coverage apps/web/test/settings-privacy-delete-postgres.test.ts`
  against that database — one test passed. Synthetic telemetry is readable
  before deletion and the entire member row is absent afterward. The route
  harness stubs the deletion service but uses real PostgreSQL/auth; separately,
  inspection confirms the production service's terminal member CTE executes
  `DELETE FROM hosted_member`, and its existing focused service suite passes.
- `pnpm --dir apps/web exec oxlint src/lib/companion/client-info.ts src/lib/companion/presence.ts src/lib/http.ts app/api/companion/heartbeat/route.ts test/companion-client-info.test.ts test/companion-presence.test.ts test/companion-presence-route.test.ts test/http.test.ts test/hosted-onboarding-privacy-foundation-migration.test.ts test/hosted-onboarding-member-store.test.ts test/join-resume-page.test.ts test/page-auth.test.ts test/settings-privacy-delete-postgres.test.ts`
  — one pre-existing unused import warning in `http.test.ts`.
- `pnpm complexity:diff` — zero hotspots above 20; no complexity debt increase.
- `pnpm docs:drift` and `git diff --check`.

## Review and handoff

The full diff and new files were reviewed for header bounds, legacy requests,
optional-field clearing, query count, account deletion, deployment compatibility,
and identifier leakage. No native bearer-auth path was changed. No schema or
behavior discrepancy from the brief was found. The parser has no `server-only`
marker so the shared HTTP owner remains usable in ordinary Node consumers.

The initial focused run returned EXIT=1 because the deletion suite imported
missing generated changelog fragments (188 other tests passed). The existing
Frog entry `20261114135050-direct-web-vitest` covers this fresh-worktree
prerequisite; no duplicate entry was created. `pnpm --dir apps/web typecheck`
generated the fragments. Its first run returned EXIT=2 for three complete
HostedMember fixtures and one parameterized-test type, all corrected before
the final passing checks.

Parent owns push, PR, exact-head CI, and the final schema/privacy ReviewGPT gate.
Deploy the additive migration before Web; keep the columns for Web rollback.
After deployment, check a heartbeat's five columns and a JSON error's validated
client context. Older clients continue returning the same heartbeat response.
Completed: 2026-11-15
