# Hosted runtime normal-completion marker

Status: active
Created: 2026-08-25
Updated: 2026-08-25

## Goal

- Make every successfully resolved hosted workspace invocation emit one typed,
  deidentified terminal runtime event so an empty system-mailbox pass can be
  distinguished from an invocation that aborted after mailbox import.
- Preserve runtime results, scheduling, checkpointing, retries, and all other
  control flow exactly.

## Success criteria

- The exported in-process invocation owner emits exactly one
  `runtime.invocation_finished` event after its private implementation resolves.
- The event contains only the existing typed attempt attribution and normalized
  processing mode; it contains no member data or inferred state/outcome fields.
- A successful empty system-mailbox import produces both its existing zero-count
  `mailbox.imported` log and the new terminal event for the same attempt.
- A thrown or aborted invocation produces no terminal event.
- Focused runtime-control and assistant-runtime tests and typechecks pass, and
  required PR review gates resolve on the exact pushed candidate head.

## Scope

- In scope: the hosted-execution typed event-code registry, the assistant-runtime
  exported invocation boundary, and focused production-path regression coverage.
- Out of scope: replay, alerts, persistence, schemas, queues, retry behavior,
  checkpoint behavior, state owners, and inferred no-work classification.

## Constraints

- Technical constraints: use the existing structured-log pipeline; emit only
  after successful resolution; keep the invocation result byte-for-byte
  unchanged; retain all legacy runtime phase diagnostics.
- Product/process constraints: metadata only, one event per normal invocation,
  no user-visible behavior change, isolated worktree/draft PR, focused proof,
  preliminary specialists and final ReviewGPT gate before merge authorization.

## Risks and mitigations

1. Risk: adding markers to scattered early returns misses a normal path or
   duplicates another.
   Mitigation: wrap the one exported owner around a private implementation and
   emit once after its awaited result.
2. Risk: derived `no_work`, checkpoint, or wake fields drift from their real
   owners.
   Mitigation: omit them; correlate the terminal event with the existing typed
   mailbox-import event by attempt id.
3. Risk: telemetry failure changes invocation behavior.
   Mitigation: use the existing synchronous best-effort structured logger and
   return the implementation result unchanged.

## Tasks

1. Prove the empty successful return and thrown/aborted seams in current code
   and focused tests.
2. Register `runtime.invocation_finished` and add the one exported-owner wrapper.
3. Add focused success/no-terminal-on-error coverage and run scoped checks.
4. Inspect the diff/privacy boundary, commit and open a draft PR, then run the
   required exact-head specialist/final review gates and CI.

## Decisions

- Keep the event shape to `eventCode`, `attemptId`, and normalized
  `processingMode`. The event's presence is the success signal; existing
  `mailbox.imported` counters prove the empty/no-work case without duplicated
  or inferred terminal fields.
- Keep the current `runtime.return` phase diagnostics unchanged. They serve
  phase timing and are not the typed terminal event owner.

## Verification

- Commands to run: focused assistant-runtime entrypoint test, hosted-execution
  runtime-control test, both affected package typechecks, `git diff --check`,
  privacy scan, required exact-head ReviewGPT gates, and required GitHub checks.
- Expected outcomes: exactly one typed terminal event on successful empty system
  processing, none on thrown/aborted execution, unchanged invocation result and
  passing affected package contracts.
