# Hosted Provider-Turn Latency Telemetry

Status: completed
Updated: 2026-07-16

## Why

A production warm-runtime trace measured 5,648 ms between the local Codex
`turn/start` boundary and provider completion, with the first local output at
5,569 ms. Existing hosted milestones cannot determine how much of that interval
belongs to the Murph-to-App-Server handoff versus provider execution. The
current App Server protocol does not expose upstream dispatch, response-header,
or first-byte boundaries, so better local metadata is needed before changing
provider or runtime behavior.

## Outcome

Extend the existing hosted turn-timing telemetry with the smallest truthful
content-free boundaries already emitted by Codex App Server. The added fields
must let operators separate locally observable handoff/stream phases without
adding awaited I/O or size-dependent work, or claiming upstream phases that the
current protocol does not expose.

## Invariants

- No new foreground await, synchronous request, network call, database write,
  body buffering, stream transformation, dependency, or persisted state class.
- No prompt, transcript, model output, request/response body, identifier, token,
  URL, filesystem path, or other content in telemetry.
- New values are bounded numeric durations, booleans, or closed enums parsed by
  the existing strict schema and emitted only through the existing best-effort
  runtime-log path.
- Telemetry adds only constant-time timestamp/property bookkeeping at existing
  local RPC boundaries. Missing optional timing metadata degrades only
  observability.
- Do not invent a boundary. If Codex exposes no truthful upstream dispatch or
  first-byte event, report that limitation and instrument only the nearest
  existing observable ownership transitions.

## Scope

- Inspect the Codex App Server protocol adapter and the Worker provider-egress
  interceptor before selecting fields.
- Extend only the existing assistant event and hosted runtime log
  contracts needed for the selected boundaries.
- Add focused package regression proof for strict redaction/schema parsing and no
  foreground await or delivery-order regression.
- Update the owning runtime/observability docs when the field contract changes.

## Steps

1. Trace `turn/start` through App Server output and Worker provider egress;
   inventory which metadata-only timestamps are already observable.
2. Choose the smallest owner-correct timing extension and record its limits.
3. Implement strict parsing plus queued best-effort emission without new I/O.
4. Add focused package coverage and direct ordering proof.
5. Run truthful diff/owner verification, required `coverage-write`, parent final
   review, scoped plan-closing commit, and open a draft PR.
6. Start ReviewGPT on the exact pushed head concurrently with PR CI; address
   accepted findings without broadening the architecture.

## Design Chosen

- Add assign-once, cumulative local offsets to the existing App Server
  `turn-completed` timing trace, joined by the existing provider-request
  ordinal. The offsets cover local `turn/start` acknowledgement, the App Server
  `turn/started` and `turn/completed` notifications, and completion-trace
  emission after local drains. Existing attempt-bound assistant milestones
  remain the source of truth for first local output/text.
- Do not inspect WebSocket frames or mediate response bodies. Existing GET/101
  logs describe only the WebSocket handshake and cannot be durably joined to a
  turn, so they are documented as coarse supporting evidence rather than a
  provider-generation boundary.

## Verification

- Focused tests for each changed parser/event/log owner during iteration.
- `pnpm test:diff <touched paths>` when its selected owner coverage is truthful;
  otherwise the required owner coverage commands from the verification map.
- Static and behavioral proof that telemetry adds no awaited I/O, network call,
  body mediation, size-dependent work, or delivery-order dependency. Only
  constant-time timing and strict field allowlisting run on existing paths.
- `git diff --check`, privacy/redaction inspection, base-to-head scope review,
  and exact-head PR/mergeability checks.

## Results

- Exact-head focused App Server telemetry test: passed.
- Exact-head reverse-order/assign-once timing test: passed.
- Exact-head hosted runtime parser/redaction suite: 33 passed.
- Assistant-engine and assistant-runtime typechecks: passed.
- Required coverage-write, security/privacy, simplify, and task-finish audits:
  zero unresolved findings after remediation.
- `pnpm test:diff` passed guards and all six affected typechecks, then failed in
  reverse-dependent package tests under severe machine contention. Unrelated
  setup-cli targets hit their 5-second limits in isolation; with a 30-second
  override one passed and the other timed out after 30.3 seconds following a
  120-second import. No changed-owner failure reproduced.
- `git diff --check`, stale-field search, privacy review, and exact base
  alignment passed.

## Deployment Concerns

The assistant-engine producer and assistant-runtime parser ship in the same
runner bundle. Every new field remains optional and unknown or absent metadata
is ignored, so no coordinated Worker/Web deployment or schema migration is
required.
Completed: 2026-07-16
