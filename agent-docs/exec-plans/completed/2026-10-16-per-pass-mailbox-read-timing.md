# Time each import pass's conversation mailbox read

Status: completed
Created: 2026-10-16
Updated: 2026-10-16

## Goal

- Make a warm wake's later mailbox reads separable into connection setup,
  response wait, and runtime continuation. The invocation-first fields from
  `2026-10-16-cold-typing-transport-observation` cannot attribute a read that is
  not the invocation's first request. This is diagnosis, not a latency reduction.

## Success criteria

- Each import pass's existing `mailbox.imported` entry carries `passMailboxFetch*`
  scalars for the first attempt of the conversation read that pass consumed. No
  request, retry, ordering, typing, measurement-origin, or authority changes.
- Synthetic tests prove a later pass has its own timing, with no first-request
  leakage, and that overlap, retry, cancel, and a replaced failed prefetch
  stay correct. Each test fails under the prior behavior.
- Typecheck, focused tests, complexity, runner bundle budgets, review, and CI pass.

## Scope

- In scope: wrap each conversation-lane mailbox port read with the existing
  first-call observer; carry its scalars through the fetch response and the import
  result onto the existing pass log row; document the fields.
- Out of scope: any latency optimization, new event codes, extra requests, Web
  parser or alert-query changes, and the cold handoff orchestration.

## Constraints

- Runtime-log `redactedJson` admits only bounded scalar keys whose names avoid
  the forbidden raw-field substrings. Never include URLs, IDs, headers, or bodies.
- The invocation-first claim shares the same observation, so no request is
  observed twice.

## Risks and mitigations

1. Risk: observation changes fetch behavior or overhead.
   Mitigation: the existing observe-only wrapper, applied once per conversation
   read (about 0.03 ms on loopback).
2. Risk: misread on retry.
   Mitigation: `passMailboxFetchAttemptCount` reports the logical read's
   attempts. The timing still describes the first attempt, as documented.

## Decisions

- Reverses the earlier "warm per-wake coverage omitted" decision, scoped to one
  observation per conversation read on the existing pass row.

## Verification

- Commands to run: Cloudflare and assistant-runtime typecheck; focused Vitest
  for the collector, diagnostics, mailbox decode, runner platform, restore
  preparation, invocation, entrypoint, mailbox import, and fetch-transport log
  tests; `pnpm complexity:diff`; `runner:bundle`.
- Expected outcomes: all pass, and the invocation-first fields are unchanged.
Completed: 2026-10-16
