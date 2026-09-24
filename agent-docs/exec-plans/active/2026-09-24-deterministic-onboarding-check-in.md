# Deterministic onboarding stall check-in

Status: active
Created: 2026-09-24
Updated: 2026-09-24

## Goal

Restore one early low-pressure onboarding check-in without a foreground model scheduling call. Reuse canonical automations and existing hosted managed maintenance.

## Success criteria

- Exactly one finite automation anchored to existing onboarding start, due after 15 minutes.
- No duplicate, restart, group enrollment, or stale-member backfill.
- Send only for an open setup question unanswered at least ten minutes; skip answers, recent questions, pauses, and completion.
- Focused deterministic and live assistant proof, typecheck, candidate review, exact-head CI and final ReviewGPT, merge and deployment.

## Scope and constraints

Use existing state, canonical automation authoring, cron evaluation/outbox, and post-delivery maintenance. No new scheduler, queue, or onboarding stage state. Keep the existing opening prompt's prohibition on model scheduling. The prior restoration commit is superseded by this implementation; its completed plan remains historical evidence.

## Product UX

Feature restoration. Cover stalled setup, active replies, requested pauses, completed setup, old accounts, replay, paused/archived existing schedules, and direct/group route isolation. Timing uses onboarding start, as stated to the user while the optional clarification remained unanswered. Backend enrollment never promises a message regardless of context.

## Tasks

1. Add bounded deterministic enrollment to the existing managed onboarding owner.
2. Adapt the live opening proof to zero scheduling calls and evaluate canonical saved instructions.
3. Prove lifecycle, latency boundary, and composed delivery; update the product owner and changelog.
4. Verify, review, open PR, complete required gates, merge, and deploy.

## Verification

- Passed: 336 focused automation tests, including real canonical managed enrollment, concurrent create-only writes, replay, preserved active/paused/archived sources, direct/group isolation, expiry, and send/skip consumption.
- Passed: 137 hosted foreground and managed-maintenance tests. Existing post-checkpoint ordering, yielding, retry, and wake projection remain the owners.
- Passed: 113 prompt/skill tests, seven pre-existing skips. Production opening prompts and skills match main exactly.
- Passed: final engine typecheck and 83 focused enrollment/managed tests after the background helper extraction.
- Passed: focused real-Codex journey on GPT-6 Sol using local subscription authentication. Opening made zero scheduling calls and one native identity child; canonical facts and one deterministic automation read back. Reply took 10,430 ms, versus 22,679 ms in the prior model-scheduling sample (individual local samples, not causal production benchmarks).
- Live scheduled replays: stalled sent one pressure-free check-in; answered, recent question, paused, and completed skipped. No scheduling chains or changes to the saved automation. Parent prose review: Ready.
- Complexity guard passed: existing managed-automation hotspots remain 52, 28, and 21 unchanged. A small private background reconciliation function composes early and daily enrollment without adding branches to the existing large owner.
- Changelog generation, ten archive rendering tests, docs drift, docs gardening, whitespace and privacy checks passed. Candidate commit, CI, ReviewGPT, merge, and deployment remain pending.

## Parent candidate review

Existing canonical state and create-only registry locking suffice. No schema, tool contract, scheduler, queue, dependency, initial provider input, or foreground awaited operation is added. Enrollment failures use existing maintenance retry; a missed enrollment deadline skips rather than backfills. Existing canonical at/activeUntil readers support old/new runtime skew. The old prompt-restoration commit is fully superseded: no restored model scheduling instruction remains in the candidate.
