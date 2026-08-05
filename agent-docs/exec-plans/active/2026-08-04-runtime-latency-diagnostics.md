# Hosted reply latency diagnostics

Status: active
Created: 2026-08-04
Updated: 2026-08-04

## Goal

- Make hosted reply-latency alerts identify the dominant slow boundary and
  distinguish a fresh missing reply from a terminal no-reply that never gained
  durable checkpoint acknowledgement, without logging message content or
  member identifiers.

## Success criteria

- Alert health and email diagnostics separate pre-provider, provider/assistant,
  and unknown slow-reply boundaries.
- Unresolved diagnostics separate rows with no terminal evidence from terminal
  no-reply rows whose checkpoint expectation expired.
- Checkpoint lifecycle logs record bounded counts plus an identifier-free
  boolean proving whether the selected batch contains the exact conversation
  frontier; finished logs separately state whether Web accepted the checkpoint.
- Focused Web and assistant-runtime tests plus affected typechecks pass.
- Required exact-head ReviewGPT and CI gates pass before completion.

## Scope

- In scope: the Web latency monitor, checkpoint lifecycle log metadata, focused
  tests, and live architecture/reliability documentation for the new diagnostic
  fields.
- Out of scope: changing the 30-second SLO, suppressing genuine alerts, changing
  assistant progress behavior, repairing production rows, or adding new state
  owners and queues.

## Constraints

- Technical constraints: reuse existing phase timestamps, runtime log storage,
  and checkpoint request fields; diagnostics must remain metadata-only and
  bounded.
- Product/process constraints: preserve foreground reply priority, checkpoint
  fail-closed behavior, and the existing Web/Cloudflare/runtime ownership split.

## Risks and mitigations

1. Risk: aggregate classification could hide invalid or incomplete chronology.
   Mitigation: keep existing chronology validation and classify incomplete rows
   as unknown instead of guessing.
2. Risk: checkpoint logs could leak durable mailbox identifiers.
   Mitigation: log counts and booleans only; never log item ids, input ids,
   message text, or member identity.

## Tasks

1. Add failing monitor tests for provider-dominant, pre-provider, unknown, and
   expired terminal-checkpoint cases.
2. Add the smallest aggregate classification and alert-copy changes.
3. Add checkpoint lifecycle frontier-selection diagnostics and focused tests.
4. Update current owner docs, run focused verification, inspect the diff, and
   complete the exact-head PR gates.

## Decisions

- Production evidence showed sub-second durable signaling for the sampled
  completed replies. The dominant elapsed time was inside the assistant/provider
  turn, often with multiple command or dynamic-tool actions.
- One terminal reaction-only turn is the sole unconsumed hole in its conversation
  lane. Later rows are acknowledged and repeated successful checkpoints have
  not repaired it, but current logs do not record whether that row was present
  in the checkpoint candidate list.
- Exact-head review rejected count-only routing because rotating batches can be
  nonempty while omitting the frontier. The accepted correction derives
  frontier membership inside the existing pending-index selection owner and
  carries only that boolean into redacted lifecycle telemetry.

## Verification

- Passed: focused Web latency-monitor tests (44 tests), existing Web exact-row
  checkpoint stamping tests (46 tests), focused assistant-runtime index/bridge
  tests (73 tests), the production workspace entrypoint scenario, Web and
  assistant-runtime typechecks, and focused Web lint with no errors.
- Remaining: required ReviewGPT passes and exact-head GitHub Actions.
- Expected outcomes: aggregate classifications are deterministic, invalid
  chronology remains fail-visible, checkpoint logs contain only bounded counts
  and booleans, and all required checks are green.
