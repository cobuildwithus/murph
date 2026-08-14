# Alternating routine set resolution

## Goal

Make terse repeated-set completion messages resolve the current exercise from the member's canonical active plan and member-local date before any write or cumulative-total response.

## Success criteria

- A saved experiment or habit schedule outranks conversational recency when selecting the current exercise and per-set standard.
- A confirmed range of sets creates one canonical occurrence per set for the resolved exercise, with the current quantity attached to every occurrence.
- Missing or conflicting canonical plan evidence produces one narrow clarification and no write.
- Cumulative totals are computed only from explicit events linked to the resolved plan owner.
- The incident evidence report and regression fixture contain no private member identifiers or distinctive production wording.

## Scope

- Assistant guidance and discovery routing for repeated exercise-set completions.
- Synthetic regression coverage for canonical target resolution.
- Private-only completion writes with a compact group-to-private handoff.
- A privacy-safe incident report and member-facing changelog entry.

Out of scope: schema or CLI changes, production data repair, live-workout-card behavior, and new persistent state.

## Canonical owners

- Experiment or habit-regimen records own the saved alternating schedule and per-occurrence standards.
- Intervention sessions own explicitly completed occurrences.
- Experiment progress owns adherence counts and linked-event totals.
- Assistant skills own the read-before-write resolution policy.

## Evidence so far

- Primary control-plane records show normal direct-message ingestion, one provider turn, and delivered replies around the report window.
- A prior occurrence-counting fix defined how many sessions to write and how to total them, but did not require resolving today's exercise from the canonical plan before those writes.
- The dedicated hosted-runtime-log database helper is unavailable in this environment, so exact model tool-call telemetry is not part of the evidence set.

## Verification plan

- Focused assistant-engine skill regression tests.
- Assistant-engine typecheck.
- Changelog validation and web typecheck.
- Exact-head CI plus preliminary and final ReviewGPT review.

## Decisions

- Fix the semantic-owner contract at the assistant skill boundary; the persistence layer already records and totals the exact owner it receives.
- Preserve the existing running/cardio and recovery routing semantics while adding the smallest explicit private repeated-set route and group handoff. The measured stable-input increase is 36 tokens in representative direct and group requests.
- Keep reminder automations out of exercise resolution; canonical regimen and experiment records remain the only schedule owners.
- Leave historical record correction out of the patch because it requires a separate private verification with the affected member.

## Local verification

- Focused assistant-engine tests: 116 passed, with 6 conditional tests skipped.
- Real-model repeated-set scenarios: 3 passed across direct success, direct ambiguity, and group privacy/handoff paths.
- Assistant-engine typecheck: passed.
- Focused changelog tests: 57 passed.
- Web typecheck: passed.
- Provider-input measurement: +36 tokens and +198 bytes in representative direct and group requests.
Status: completed
Updated: 2026-08-13
Completed: 2026-08-13
