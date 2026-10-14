# Group shared-read timing telemetry

Status: active
Created: 2026-10-13
Updated: 2026-10-13

## Goal

- Attribute slow successful group `read_shared` calls (tracked in #3997) to
  intentional freshness polling, Web callback time, or a terminal freshness
  decision, without changing read behavior or emitting member data.

## Success criteria

- One content-free `assistant.automation_detail` record per accepted read from
  the interactive and scheduled group operations, accepted by the current
  runtime-log parser.
- Exact one-refresh rule, 15-second poll cadence, deadline, callback order,
  fallback, cancellation, and results unchanged; the 14 prior freshness tests
  still pass.
- Observer failure or a stalled log sink cannot affect a read.

## Scope

- In scope: optional observer on `createHostedGroupSharedReader`, wiring in
  `workspace-assistant-phase.ts`, focused synthetic tests, owner-doc section in
  `docs/hosted-runtime-log-database.md`.
- Out of scope: any latency optimization, the unscoped detached-ask reader,
  failed-tool semantic-validation contracts, deployment, production queries.

## Decisions

- Callback time is measured by a thin port wrapper making the same calls in the
  same order; poll time wraps only the existing `delay`.
- Terminal decision is derived by a helper that keeps the original loop
  short-circuit order.
- Web `refreshStatus = 'not_needed'` is a distinct `not_needed` decision;
  `unavailable` or absent freshness stays `refresh_unavailable`.
- Outcome is the returned result's own `status` (`ok`, `none`,
  `unavailable`), so Web no-data `none` stays distinct from `unavailable`.
- Only input/capability-validation rejects emit nothing; a valid request with
  an already-aborted signal is a `canceled` completion with zero callbacks.
- Measurement finalization lives in a small typed helper so the request
  function stays within the complexity guard (max 20, debt 0).
- The wait budget bounds the existing sleep/poll loop, not callback time. No
  model input/output, auth, poll cadence, or wait changes.
- Known gap, unchanged by design: direct `groupTool` `read_shared` calls bypass
  the reader and emit nothing (the model tool path uses the reader).
- The observer runs in a microtask with throw/rejection swallowed; the wiring
  returns the queued info write so its rejection is contained too.
- `canceled` records an aborted signal only; it never claims Web work stopped.

## Verification

- `pnpm complexity:diff`
- `pnpm --dir packages/assistant-runtime typecheck`
- `vitest run test/hosted-runtime-group-freshness.test.ts` (14 prior + new
  telemetry tests, including no-data `none` and pre-aborted `canceled`), the
  scheduled wiring test in
  `test/hosted-runtime-workspace-assistant-phase-scheduling.test.ts`, and the
  interactive wiring test (outcome `none`) in
  `test/hosted-runtime-workspace-assistant-phase-managed-automation.test.ts`.

## Remaining

- Parent: review, PR, CI, and #3997 update.
- After a verified deployment of this revision, run the owner-doc aggregate over
  a 24–72 hour window. Protected deployment may be blocked if the workflow
  cannot select this candidate revision; record the observed condition.
