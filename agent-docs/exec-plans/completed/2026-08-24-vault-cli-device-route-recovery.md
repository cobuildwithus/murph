# Vault CLI Device, Wearable, And Route Recovery

Status: completed
Created: 2026-08-24
Updated: 2026-08-24

## Goal

Make device, wearable, and route failures truthful and directly repairable by
the calling model without exposing submitted values, provider bodies, local
paths, or raw exception text.

## Evidence And Ownership

- The shared repair contract and final CLI transport already live in
  `@murphai/operator-config` and `packages/cli`; this change extends domain
  owners rather than adding another error transport.
- Mapbox request, directions, point-resolution, and elevation modules own route
  phase/status classification.
- The hosted device dynamic tool owns its bounded model-visible result.
- The wearable command/query boundary owns metric and date admission before an
  unsupported request can look like an empty successful result.

## Root Cause

- Mapbox failures crossed the final CLI boundary as ordinary exceptions, so
  HTTP status, phase, and retryability were lost while raw provider text could
  be echoed.
- The hosted device wrapper collapsed typed service failures and oversized
  results to generic strings without correction guidance.
- Wearable metric and calendar filters admitted unsupported metrics,
  impossible dates, and reversed ranges, allowing invalid questions to look
  like successful empty reads.

## Product UX Patch

- Outcome: a model can correct an invalid device, wearable, or route call, or
  make a truthful retry decision, from the first safe failure envelope.
- Reaches: existing hosted device actions and local `wearables` and `route`
  Vault CLI journeys; no command or audience is added.
- Proof: focused final-envelope, retryability, non-echo, route degradation,
  metric, calendar-date, and reversed-range tests plus affected package
  typechecks.

## Invariants

- Project only stable codes, retryability, phase, and value-free repair hints.
- Never serialize raw provider bodies, submitted addresses/metrics/dates,
  credentials, absolute paths, or raw causes.
- Optional elevation failure must preserve already-resolved route directions.
- Invalid metric/date/range input must fail before it can masquerade as no data.
- No new retry owner, persisted state, service, or dependency is introduced.

## Plan

1. Inspect the foundation repair contract, current domain owners, tests, and
   generated CLI behavior; prove each existing failure path.
2. Add the smallest domain mappings and input validation at their current
   ownership boundaries.
3. Add focused safe-envelope and degradation tests, including non-echo checks.
4. Run focused tests, affected typechecks, built-CLI proof, diff/privacy checks,
   and the Product UX walkthrough.
5. Inspect the final scope and close this plan with `scripts/finish-task`.

## Progress

- Confirmed PR #2189 does not overlap the planned files; the only related open
  PR is the requested error-foundation change.
- Created the sanctioned task worktree and branch from the exact foundation
  commit, then cleanly rebased the preserved patch onto the updated foundation
  head before final verification.
- Mapbox transport, HTTP, response-shape, no-route, and point-resolution
  failures now retain stable codes, retryability, and finite operation stages
  without reading provider error bodies. Optional terrain failure returns the
  valid route with explicit partial-result guidance.
- Hosted device results now project only allowlisted safe failures and give
  account-list filtering guidance when a result exceeds the tool limit.
- Wearable metric aliases have one catalog owner. Unsupported metrics,
  impossible calendar dates, and reversed ranges now fail before a query runs,
  with field-specific value-free guidance.
- Focused source tests pass: 44 CLI tests, 7 assistant-engine tests, 5
  operator-config tests, 26 query tests, and 55 health-metrics tests. All five
  affected package typechecks pass.
- The prepared test-runtime build and CLI package build pass. Built CLI smokes
  prove unsupported metric, impossible date, and reversed-range envelopes; the
  final outputs do not echo the submitted values.
- Product UX replay passes for route callers receiving a valid route after
  optional elevation failure, hosted models narrowing oversized device lists,
  and wearable callers correcting a field before any read executes.
- No changelog entry is needed because this is internal error recovery and
  validation behavior on existing commands, not a new member-visible feature.

Completed: 2026-08-24
Completed: 2026-08-24
