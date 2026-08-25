# Stop unsupported Junction workout-stream retries

Status: active
Created: 2026-08-24
Updated: 2026-08-24

## Goal

Use the existing connection-source capability projection to request workout
streams only for connected Junction sources that advertise `workout_stream`,
while preserving the existing bounded resource/day continuation, cursor,
retry, empty-stream, and canonical-import owners.

## Proven gap

- Full account reconciles enumerate account-wide workout summaries before
  considering source capability.
- Sources can advertise `workouts` without advertising `workout_stream`.
- A stream request for such a workout can return a deterministic HTTP 400,
  terminalize the job, and be recreated by the next scheduled reconcile.
- The current optional-resource classifier recognizes clear unsupported
  provider text but admits optional skips only for HTTP 404 and 422.

## Architecture

- Read the already-projected connection sources through
  `ProviderJobContext.listConnectionSources()`.
- Canonicalize source slugs and derive the eligible set from connected sources
  whose stored availability advertises `workout_stream`.
- Complete the optional resource with no workout-index or stream egress when
  the set is empty.
- Filter mixed-source workout summaries to that set before bounded candidate
  selection and progress reconciliation.
- Treat only a clear unsupported HTTP 400 from the exact workout-stream
  candidate request as an optional candidate skip. Unknown, malformed, and
  request-shape 400s remain terminal.
- Add no state, queue, service, lifecycle, or retry owner.

## Product UX

- Effort: Patch.
- Outcome: members with one or several connected workout sources keep receiving
  supported workout detail when another source does not provide streams.
- Reaches: the existing background connected-health workout reconciliation;
  there is no new member action, audience, or surface.
- Proof: provider-shaped tests cover unavailable-only, mixed-source,
  unattributed, exact unsupported, ambiguous failure, continuation, and import
  outcomes.
- Walkthrough: Ready. Incapable sources keep their existing workout facts,
  capable siblings continue importing, and ambiguous failures stay visible.

## Tasks

1. [x] Add focused failing regressions for unsupported-only, mixed-source,
   clear-unsupported 400, and unknown/request-shape 400 behavior.
2. [x] Implement capability-derived candidate admission at the existing
   Junction provider/context boundary.
3. [x] Run focused tests, package typecheck, diff/privacy inspection, and
   direct behavior proof.
4. [x] Add the smallest truthful public changelog item after the draft PR has
   assigned its source number.
5. [ ] Commit, push, open a draft PR, and run the required preliminary and
   final ReviewGPT gates against one exact candidate head.
6. [ ] Resolve accepted findings, require exact-head CI, and close the plan.

## Verification

- Focused Junction workout-stream provider/service tests.
- `pnpm --dir packages/device-syncd typecheck`
- `git diff --check`
- Exact-head required CI and ReviewGPT.

## Deployment

This is a Cloudflare hosted-runner bundle change only. Existing Web contracts,
database schema, queued job payloads, and persisted cursors remain compatible.
Old warm runners may retain the previous behavior until recycled; rollback does
not require data repair.
