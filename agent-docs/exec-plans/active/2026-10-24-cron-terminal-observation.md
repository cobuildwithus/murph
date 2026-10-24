# Observe terminal cron delivery outcomes

Status: active
Created: 2026-10-24
Updated: 2026-10-24

## Goal

- Distinguish a scheduled delivery still pending from one reconciled to a terminal outcome using existing hosted telemetry, without changing delivery behavior.

## Success criteria

- A synthetic pending cron occurrence produces a privacy-safe, correlated terminal observation only after successful owner reconciliation.
- Sent, failed, abandoned, missing, replay, and failed-persistence paths retain their existing durable behavior; telemetry cannot block or change the outcome.
- Focused regression proof, relevant typechecks, parent review, final ReviewGPT, and exact-head CI pass before merge.

## Scope

- In scope: the existing cron reconciliation owner and hosted telemetry projection, focused tests, and owner documentation.
- Out of scope: new product state, queues, retry policy, provider contracts, delivery claims beyond the existing owner, production recovery, or member messages.

## Constraints

- Technical constraints: reuse existing observation transport; bounded low-cardinality fields and privacy-safe correlation; no awaited network or telemetry work on reply paths.
- Product/process constraints: ReviewGPT authors substantive implementation; use synthetic evidence only. Existing PR 2629 changes delivery-reason interpretation, not terminal telemetry; preserve its independent scope.

## Risks and mitigations

1. Risk: an observation could imply handset delivery or survive a failed owner write.
   Mitigation: explicitly name the existing outbox-terminal boundary, emit after persistence, test failures, and preserve provider delivery distinctions.
2. Risk: additive telemetry could delay work or leak private automation content.
   Mitigation: reuse bounded best-effort logging and test correlation fields and forbidden payloads.

## Tasks

1. Trace current reconciliation, existing receipts, and hosted observation owners; reproduce the missing observation with a synthetic occurrence.
2. Obtain a minimal ReviewGPT implementation and critically inspect the patch.
3. Prove the regression before and after, run focused tests and typechecks, and update the durable owner documentation.
4. Complete scoped commit, draft PR, final review and required CI; merge and deploy under standing authorization when gates pass.
5. Verify serving revision and affected outcomes; use the native heartbeat for the four-hour observation if available, otherwise report that concrete capability gap.

## Decisions

- Current source finalizes the run journal and clears pending state without emitting a hosted terminal event. Existing local diagnostic receipts are not exported as correlated cron completion observations.
- No durable schema or scheduling behavior should change. The canonical job, run journal, and outbox remain authoritative; telemetry remains best effort.
- An additive telemetry-only change supports old/new runtime and Web coexistence without a migration; historical unobserved outcomes remain unresolved.

## Verification

- Baseline: `pnpm --dir packages/assistant-engine test test/assistant-cron-runtime.test.ts -t delivery` passed 34 tests, with 252 unrelated tests skipped.
- Local Node is below the declared repository version; exact-head CI must provide the supported runtime proof.
- Commands to run: new focused regression tests, affected package typechecks, `pnpm complexity:diff`, and required privacy/docs checks.
- Expected outcomes: exact terminal evidence, no duplicate observation on no-op reconciliation, no claim before failed persistence, and unchanged durable outcomes when the observer fails.

## Implementation evidence

- ReviewGPT authored the additive observation patch in the existing reconciliation and hosted log owners; parent review confirmed persistence ordering, observer containment, keyed correlation, and no delivery-policy changes.
- The 18 new observation tests fail against unchanged source: 14 engine boundary cases and four hosted projection cases. After implementation, all 962 tests across the five affected files pass.
- Both affected package typechecks pass. `pnpm complexity:diff` passes with no additional complexity debt; existing large dispatch and runtime functions only gain observer plumbing. Splitting those unrelated decision owners would expand scope without improving this observation boundary.
- Product UX and changelog: internal-only telemetry, with no changed prompts, replies, schedules, permissions, or delivery behavior.
- Final external review and exact-head CI remain required before merge. The native heartbeat tool is unavailable, and the current chat's scheduled-task UI is disabled; four-hour automated observation is currently blocked.
