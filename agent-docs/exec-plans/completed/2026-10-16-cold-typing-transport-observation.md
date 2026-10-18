# Observe cold typing and first mailbox transport phases

Status: completed
Created: 2026-10-16
Updated: 2026-10-16

## Goal

- Make the cold first typing start and the first conversation mailbox fetch
  separable into connection setup, response wait, and runtime continuation in
  queryable telemetry, so a later fix targets the measured cause. This is
  diagnosis, not a latency reduction.

## Success criteria

- Each invocation's existing `runtime.invocation_finished` entry carries
  first-request transport scalars without an added request, ordering change,
  retry, or authority change.
- Response, error, abort, and streaming identity are unchanged. Real-socket
  tests cover reuse, cold lookup, failure, lane selection, and redaction
  acceptance.
- Typecheck, focused tests, complexity, runner bundle budgets, review, and CI pass.

## Scope

- In scope: reuse the existing snapshot-fetch transport observer for the Linq
  typing start and conversation-lane mailbox fetch attempts; carry a per-job
  collector through restore preparation and invocation; document the fields.
- Out of scope: any latency optimization, PR4126 correlation changes, new
  event codes, latency-trace protocol changes, and Web parser changes.

## Constraints

- Technical constraints: container stdout is not queryable, and the
  `assistant_milestone` parser rejects unknown keys (unsafe under deploy skew).
  Runtime-log `redactedJson` admits bounded scalar keys whose names avoid the
  forbidden raw-field substrings.
- Product/process constraints: the typing call order and measurement origin
  are unchanged; no private URLs, chats, headers, bodies, or member identifiers.

## Risks and mitigations

1. Risk: observation changes fetch behavior or overhead.
   Mitigation: observe-only wrapper with a guarded settle callback; measured
   loopback overhead is 0.03 ms p50 per observed request, two per invocation.
2. Risk: boot-closure growth.
   Mitigation: the collector module has type-only imports; assembly measured
   +1.7 KB within the existing budget.

## Tasks

1. Extract the reusable observer from the snapshot diagnostics.
2. Add the per-invocation first-request collector and thread it.
3. Spread its scalars onto the existing completion log entry.
4. Test, measure overhead and bundle impact, document, review, and ship.

## Decisions

- Use runtime-log `redactedJson` over the trace protocol: no deploy order
  dependency, because old Web accepts the new scalar keys.
- Record only the first observation per invocation (cold-start relevant). Warm
  per-wake coverage is deliberately omitted.

## Verification

- Commands to run: Cloudflare and assistant-runtime typecheck; focused Vitest
  for the collector, snapshot diagnostics, mailbox decode, egress, platform,
  entrypoint, restore preparation, invocation, and assistant-runtime log
  tests; `pnpm complexity:diff`; `runner:bundle`.
- Expected outcomes: all pass, and the snapshot log fields are unchanged.
Completed: 2026-10-16
