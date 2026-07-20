# Runner write-fence state hard cut

## Goal

Collapse the Cloudflare UserRunner Durable Object state to the current runtime
write-fence and status-diagnostic contract by deleting expired projections,
inert wake/backoff/deadline state, and legacy-named test adapters.

Success criteria:

- Current runner state exposes only the write fence, bound user, and live
  failure/status diagnostics used by production code.
- New Durable Objects no longer create or require `wake_at`, `backoff_until`,
  or `active_expires_at`; existing objects may retain ignored physical columns.
- Dormant legacy rows still migrate active invocation identity, generation,
  reason, start time, and workspace version into the current write fence.
- Runner status keeps its existing public/raw response behavior, including
  `inFlight`, error timestamps/codes, last invocation time, `nextAlarmAt`, and
  the raw active write-fence token.
- Focused Cloudflare tests and truthful diff verification pass.

## Constraints

- Keep runner schema version 13 so rollback code can re-add the retired
  nullable columns instead of rejecting a newer schema version.
- Do not rebuild SQLite tables or physically drop columns from existing
  Durable Objects.
- Preserve exact write-fence identity and liveness-clear semantics.
- Do not edit requested-abort behavior, runner-container lifecycle code,
  container entrypoint/egress code, deploy guidance, or hosted-local harnesses.
- Preserve unrelated worktree and coordination-ledger changes.
- Keep direct identifiers, credentials, secret values, and local paths out of
  committed artifacts and logs.

## Approach

1. Reduce runner state records and helpers to live production consumers.
2. Stop creating, reading, writing, and migrating retired wake, backoff, and
   deadline fields while preserving dormant active-fence migration.
3. Move test-only callers from invocation/lease aliases to write-fence names.
4. Refocus state tests on identity safety, diagnostics, and migration; update
   SQL helpers that encoded retired columns.
5. Remove the expired Cloudflare README compatibility claim.
6. Run focused tests, `pnpm test:diff`, privacy/diff hygiene checks, and required
   completion review before handoff.

## State

Active.

## Deployment notes

- This is a Cloudflare Worker/Durable Object implementation change. Web and
  warm runner-container request/response contracts are unchanged.
- Existing objects retain ignored extra columns. New objects use the smaller
  version-13 table. A rollback to the current Worker can add the nullable
  columns back through its existing schema ensure path.
Status: completed
Updated: 2026-07-15
Completed: 2026-07-15
