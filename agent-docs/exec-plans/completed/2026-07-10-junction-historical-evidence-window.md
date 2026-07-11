# Correct Junction historical evidence integrity

Status: completed
Created: 2026-07-10
Updated: 2026-07-10

## Goal

- Prevent current connection-day Garmin records from being mistaken for proof
  that an older historical export arrived.
- Prevent the same-epoch Link callback from erasing historical evidence that
  arrived while the connection was still pending.

## Success criteria

- A signed current-day activity or sleep webhook still imports normally but
  cannot satisfy an older connect-window historical obligation.
- A genuinely historical signed webhook can still satisfy its matching source
  and resource obligation.
- A guarded same-epoch callback atomically preserves only Junction historical
  progress/evidence while provider completion metadata remains authoritative
  for ordinary keys.
- Existing bounded retries and exact-window verification remain the sole
  recovery owner.
- No new table, queue, service, lifecycle state, or compatibility layer is
  added.
- Focused regressions, affected-workspace verification, required audits,
  ReviewGPT, and final CI are green before merge.

## Scope

- Junction direct-webhook temporal attribution, guarded account-upsert metadata
  preservation, and focused provider/store parity tests.
- No changes to retry policy, reset UX, provider credentials, storage schema,
  or unrelated wearable ingestion.

## Decisions

- Prove the bug through the signed webhook parser and normal job executor,
  rather than constructing a synthetic job window in the test.
- Fail closed when deciding whether an inline record proves historical
  coverage: import success may preserve current data without closing an older
  recovery obligation.
- Perform callback preservation inside the existing guarded store transaction;
  an ingress pre-read would retain a webhook/callback race.
- Filter the seeded metadata to the six existing Junction historical keys
  before applying the existing version-aware merge, so ordinary callback
  metadata remains replacement-authoritative.
- Reuse existing timestamps and windows; do not add persisted evidence state.

## Tasks

1. Add a failing signed connection-day regression for activity and sleep.
2. Correct evidence attribution at the smallest existing ownership boundary.
3. Preserve same-epoch historical metadata atomically in SQLite and Prisma
   guarded upserts, with callback and store parity regressions.
4. Run focused checks, required completion audits, affected-workspace
   verification, scoped commit, PR ReviewGPT, and final merge checks.

## Verification

- `packages/device-syncd`: 775 tests passed and typecheck passed.
- Hosted Prisma connection-store regression: 33 tests passed; hosted web
  typecheck passed.
- Hosted-local harness: 382 tests passed, 1 skipped.
- Affected-workspace dependency, boundary, hosted-runtime, crypto, raw-log,
  and all 14 package typecheck lanes passed. The package-test fan-out is
  locally blocked by the untouched assistant-engine test `prunes terminal
  outbox intents by instant when timestamp offsets differ`, which timed out at
  60.23 seconds under the constrained package run but passed alone in 55.54
  seconds. The modified device-sync suite remained 775/775 in the same gate.
- Security/privacy, coverage-write, and the explicitly requested post-fix deep
  review found no medium-or-higher blocker.
- `git diff --check` and the scoped identifier/secret scan passed.
- ReviewGPT against the final pushed head and final remote CI remain required
  before merge.
Completed: 2026-07-10
