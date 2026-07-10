# Close PR 516 ReviewGPT findings

Status: completed
Created: 2026-07-10
Updated: 2026-07-10

## Goal

- Preserve Garmin historical recovery as one monotonic account/source decision
  across mixed runner versions, source hydration, stale writes, future protocol
  versions, and concurrent disconnect/reconnect epochs.

## Success criteria

- Legacy or stale runners cannot replace current/future historical progress or
  clear a required source reset.
- Hosted hydration produces one semantic Junction source per provider identity.
- Account progress and its source recovery marker advance together or not at
  all when source compare-and-swap state is stale.
- Direct webhooks import canonical events without overwriting opaque
  future-version evidence.
- A stale disconnect cannot revoke or clear a newer connection/token epoch.
- Focused production-boundary regressions, package tests, typechecks, final
  audits, ReviewGPT, and PR CI pass on the final head.

## Scope

- Existing hosted device-sync authority, Junction source identity/progress,
  disconnect fencing, and focused tests/docs only.
- No new durable store, queue, resolver service, retry owner, or compatibility
  manager.

## Decisions

- Reproduce each ReviewGPT claim before fixing it and reject speculative
  compatibility machinery when the mixed-version state is unreachable.
- Keep coupled recovery truth at an existing owner boundary and prefer
  rejecting a stale transition over adding repair loops.
- Preserve opaque future protocol values byte-for-byte.
- Fence disconnect against the existing connection and credential epochs;
  serialize existing-row reconnect writes through the existing mutation lock.
- Carry the seeded row's existing `updatedAt` receipt in one-time connection
  state, reject missing/stale receipts before provider completion, and enforce
  the same receipt again inside the existing upsert transaction.
- Keep setup cleanup terminal: both stores return disconnected rows unchanged,
  even if a timestamp collision would otherwise satisfy the epoch check.

## Verification

- Device sync: typecheck passed; 40 test files and 755 tests passed.
- Assistant runtime: typecheck passed; 70 test files and 1,503 tests passed,
  with 2 existing skips.
- Hosted web: typecheck and scoped ESLint passed; 374 test files and 4,122
  tests passed, with 1 file and 9 existing skips. The final focused Prisma
  boundary run passed 33 tests.
- Security/privacy re-audit found zero evidence-backed medium-or-higher
  findings after the connection/source/setup epoch fixes and terminal-state
  parity guard.
- Required coverage-write audit found no proof gap and made no edits. Its exact
  diff-aware gate passed: device sync 755 tests, assistant runtime 1,503 tests
  with 2 skips, web 4,123 tests with 9 skips, Cloudflare 1,687 tests, all
  affected typechecks and guards, package boundaries, lint, dev smoke, and the
  production web build.
- Direct proof covers future status without legacy windows, canonical late
  webhook import without future metadata mutation, source/reset coupling,
  accepted and rejected reconnect epochs, atomic disconnect snapshots, stale
  setup cleanup, and seeded callback/upsert revision checks.
- Final ReviewGPT and final-head PR CI are pending.
Completed: 2026-07-10
