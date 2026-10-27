# Linq validation diagnostics and delivery alert release

Status: active
Created: 2026-10-27
Updated: 2026-10-27

## Goal

Improve safe Linq validation diagnostics and ship the delivery pacing alert fix.

## Evidence and decisions

The durable delivery log already retains provider codes, request shapes and trace
IDs in nested error summaries. Worker dispatch logs omit useful request context.
Provider error prose is intentionally excluded. Add closed-vocabulary field hints
from that prose; hints are lexical observations, not validated root causes.
No historical payloads or provider messages belong in this plan or test fixtures.

## Scope and constraints

Reuse parsed error context and existing Worker/durable log writes. No new I/O,
state owner, provider retry, send policy, or recipient-visible content changes.
Preserve parser object bounds by nesting new hints in the existing response
summary. Preserve the previous completed pacing plan as historical evidence.

## Tasks

1. Add safe field hints and retain request context at existing logging seams.
2. Verify parser privacy, Worker logs, durable logs, typechecks and complexity.
3. Commit, obtain required candidate review and exact-head CI, merge and deploy
   through protected hosted release workflows under current user authorization.
4. Verify deployed Web/runtime revision and record the release evidence.

## Verification

Focused operator-config HTTP, runtime dispatch and workspace delivery tests;
relevant package typechecks; prior Web alert tests; complexity and diff guards.
Use synthetic fixtures for privacy and malformed-provider cases. Live model
journeys are unnecessary because prompts, tools and reply semantics do not change.

## Candidate evidence

- Operator-config HTTP suite: 90 passed. Runtime callbacks and workspace delivery:
  410 passed. Operator-config and assistant-runtime typechecks passed.
- Prior Web alert/email suite: 57 passed; Web typecheck passed.
- Complexity guard passed: 25 existing hotspots inspected; only the drain's
  complexity changes, decreasing by one. The telemetry helpers remain below
  the threshold; no unrelated orchestration refactor is justified.
- Candidate review: closed vocabulary only, existing nine-detail durable object
  bound preserved, no new awaited calls, no retry or message-content changes.
- Historical provider validation prose cannot be reconstructed from retained
  fingerprints; improved hints apply to future failures and are not root-cause
  assertions. PR review, CI and production verification remain pending.
