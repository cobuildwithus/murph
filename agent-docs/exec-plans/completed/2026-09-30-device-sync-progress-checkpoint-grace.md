# Device-sync progress checkpoint grace

Status: completed
Created: 2026-09-30
Updated: 2026-09-30

## Goal

Prevent false device-sync mailbox stall alerts during an authorized foreground checkpoint deferral, preserving genuine stall detection.

## Scope and ownership

The Web progress monitor owns classification. Reuse its current-owner terminal foreground evidence and runtime checkpoint deadline for imported device-sync heads as well as activation. No runtime scheduling, provider, consumption, schema, or production state changes. Existing worktrees and PRs remain untouched.

## Evidence and decisions

Private read-only investigation established continued foreground completion during deferred device-sync acknowledgement, followed by accepted idle checkpoints and advanced handling. No private rows or identifiers are retained here. The runtime deliberately prioritizes foreground work. The monitor applies its existing grace only to activation, creating inconsistent classification for device-sync work at the same boundary.

## Risks and proof

Grace must end at the recorded deadline and must reject missing import, incomplete newest trace, retired or different owners, generation mismatch, and already-published completion. Synthetic unit and real local PostgreSQL tests cover both eligible kinds and retain the original age after expiry. No new query, retry, state, or external call is introduced.

## Tasks

1. Reproduce the missing device-sync grace with existing composed monitor tests.
2. Extend and rename the existing foreground evidence seam; update its owner contract.
3. Run focused unit/PostgreSQL proof, Web typecheck, complexity and diff review.
4. Close the plan and make a scoped local commit. Deployment remains a separate action.

## Verification

- Red: added device-sync cases failed on the original classification in both the unit suite and the real PostgreSQL owner query; activation cases passed.
- Green: `DATABASE_URL=<isolated-local-database> MURPH_TEST_POSTGRES_CONCURRENCY=1 pnpm exec vitest run --config apps/web/vitest.config.ts --no-coverage apps/web/test/hosted-runtime-progress-alert-monitor.test.ts apps/web/test/hosted-runtime-progress-alert-monitor-postgres.test.ts` passed all 35 tests, including both 20,000-candidate cap cases.
- `pnpm --dir apps/web typecheck` passed.
- `pnpm complexity:diff` passed, with no hotspots or debt increase.
- `pnpm docs:drift`, `pnpm docs:gardening`, `git diff --check`, and changed-file privacy inspection passed. The initial docs drift check required updating the existing index entry; that correction passed.
- Parent review: existing bounded lateral query, exact attempt/generation fence, newest-trace selection, terminal chronology, imported-head checks, and deadline expiry are preserved. No new round trip, dependency, persisted field, provider effect, or foreground await is introduced. The internal evidence name now reflects both supported system kinds.
- Production observation: primary control and isolated runtime-log queries established the cause and later cleared system lane. Temporal and Vercel read access succeeded. No Cloudflare/Render/provider investigation was needed after the evidence isolated monitor classification; no production writes were made.
- Internal alert correction; no member-facing changelog needed. Delivery stops at a scoped local commit; remote CI, PR review, and production deployment have not run.
Completed: 2026-09-30
