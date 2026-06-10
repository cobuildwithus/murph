# VaultShare v0 follow-up — contract shrink, stale-probe fix, metadata exposure, runbook SQL

Created: 2026-06-10
Updated: 2026-06-10

Goal (incl. success criteria):
- Resolve the real findings from the post-merge review of PR #104 with a net-smaller surface:
  1. Deliver response collapses to `{ status }`; `appendedCount`/`duplicateCount` are deleted
     (the runtime never reads them, and they leak fan-out cardinality and duplicate history).
  2. The deliver route's status depends only on share configuration, never on record
     staleness: an all-stale offer with a granted-but-inactive destination must return
     `no-active-share`, matching the documented invariant.
  3. One failing destination share must not block delivery to later shares (per-share
     isolation) and each share's records append in one transaction.
  4. Mailbox envelope `occurredAt` for `sleep-times.v0` becomes the night-date midnight UTC
     instead of the exact wake timestamp, so no plaintext sleep timing lands in Postgres;
     the parser asserts this server-side. Doc claim narrowed to what is true.
  5. Parser asserts `sleepStartAt < sleepEndAt` (fails closed on corrupted projections).
  6. Operator runbook SQL fixed: raw INSERT/UPDATE must set `updated_at` (no DB default;
     Prisma `@updatedAt` is client-side); re-grant documented as UPDATE (unique index).

Constraints/Assumptions:
- Web remains the sole share authority; the grantor runtime may learn only "an active share
  exists" (inherent in the status), never cardinality or duplicate history.
- Accepted residual side channels: response latency scales with granted-share count
  (sequential destination reads/deliveries), and the standard mailbox envelope columns
  (kind, lane, created_at) still record that and when a delivery happened — not when sleep
  occurred. Both are weak, pre-existing, and acceptable for operator-seeded v0 scale.
- Zero `hosted_vault_share` rows exist in the database (verified read-only), so the stricter
  `occurredAt` parser is safe to deploy web-first; un-updated runtimes fail open
  (`outcome: "error"`, logged, wake continues) until containers roll. Do not seed grants
  until both web and runner images carry this change (same tandem rule as PR #104).
- No schema/migration changes; doc + code + tests only.
- Conscious exception to completed-plan immutability: this change edits
  `agent-docs/exec-plans/completed/2026-06-10-vault-share-v0.md` because its operator
  runbook SQL would fail outright (missing `updated_at`) and its privacy claim was
  factually wrong. The runbook has never been run (zero share rows verified read-only),
  so correcting the live operator instructions in place is safer than preserving a broken
  snapshot; the snapshot's history remains in git.

Key decisions:
- Delete the counts rather than gate them: nothing consumes them, so removal is the fix.
- Anchor recency on the night date (already exposed by the dedupe key) rather than hashing
  the dedupe key; hashing would destroy operability for ~zero sensitivity gain.
- Skip fan-out batching of destination reads (≤7 records, ~1 share in v0; no measured need).

State:
- Complete; awaiting finish-task commit and PR.

Done:
- Findings verified against merged code and live DB (zero share rows; runbook never run).
- Contract/route/store/projector/parser changes plus test updates implemented.
- `pnpm test:diff` green (11 affected owners, incl. apps/web and apps/cloudflare verify).
- security-privacy-review: no blocking findings; applied ids-only delivery-failure log and
  builder-derived envelope occurredAt; recorded accepted residual side channels.
- coverage-write: added store unit tests (single-transaction, envelope determinism,
  all-duplicate null), route signal-skip + ids-only log assertions, 24h boundary test,
  projector→parser consistency test.
- task-finish-review: no blocking findings; split signal-failure swallow from
  delivery-failure logging; recorded the completed-plan-edit exception above.

Now:
- finish-task commit, push, PR.

Next:
- After merge: deploy web first; runner image rolls behind it (old runtimes fail open);
  do not seed `hosted_vault_share` grants until both sides are live.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- packages/hosted-execution/src/vault-share.ts
- packages/hosted-execution/test/vault-share.test.ts
- apps/web/app/api/internal/hosted-runtime/vault-share/deliver/route.ts
- apps/web/src/lib/hosted-mailbox/vault-share-store.ts
- apps/web/test/vault-share-deliver-route.test.ts
- packages/assistant-runtime/src/hosted-runtime/vault-share-projection.ts
- packages/assistant-runtime/test/vault-share-projection.test.ts
- apps/cloudflare/test/runner-outbound.test.ts (if it asserts counts)
- agent-docs/exec-plans/completed/2026-06-10-vault-share-v0.md (runbook SQL + claim)
Status: completed
Completed: 2026-06-10
