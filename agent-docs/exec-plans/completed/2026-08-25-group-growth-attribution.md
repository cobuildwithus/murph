# Group-to-private growth attribution

Status: completed
Created: 2026-08-25
Updated: 2026-08-25

## Goal

- Give operators one durable marker-backed total and a simple daily bar chart for retained members whose group activity was still observable inside the rolling 14-day window before their first private activation, without overstating observational attribution as causation.

## Success criteria

- `/ops/growth` shows one tracked total accumulated among retained members and a zero-filled 30-day daily bar chart.
- The calculation excludes people whose private activation predates their first retained group message and records at most one conversion per member.
- A single nullable member marker survives inbound-message content retirement and stores no sender handle, group identifier, or message content.
- Snapshot capture reuses its bounded group-message decode and performs one set-based activation read plus one conditional batch update.
- Populated and empty states have focused data/component coverage and reviewer-openable `/design` representations.
- Focused tests, typecheck, PR review, and required CI complete on the candidate head; the user explicitly waived live browser screenshots when the required browser service was unavailable.

## Scope

- In scope: one durable group-to-private conversion marker per member, tracked count among retained members, 30-day daily series, growth-page bar chart, design study, and tests.
- Out of scope: conversion-rate cohorts, participant lists, group/source breakdowns, claiming causal signup attribution, message-ingestion writes, or external analytics tooling.

## Constraints

- Technical constraints: use the 14-day retained-message window; keep reconciliation set-based; do not persist or expose raw sender/group identifiers or content; preserve existing active-user calculations.
- Product/process constraints: use the established warm scientific growth-page language and layout; render real components in `/design`; distinguish observed conversion from a proven network effect.

## Risks and mitigations

1. Risk: Retention-window truncation prevents a full historical backfill.
   Mitigation: disclose that the rolling 14-day evidence limit applies on every run and persist each observed conversion beyond message retirement.
2. Risk: A person participates in several groups and is counted repeatedly.
   Mitigation: set one nullable marker on the canonical member row only when it is still null.
3. Risk: Organic sequence is presented as causal attribution.
   Mitigation: call the metric observational, define the event ordering in the UI, and avoid language such as "caused" or "network effect proven."
4. Risk: Additional growth queries create avoidable database fanout.
   Mitigation: reuse decoded group evidence, issue one bounded activation lookup and one batch update, and read only 30 days of chart timestamps plus the total count.

## Tasks

1. Extract resolved retained group-message evidence so active-user and conversion recording share one decode/resolve pass.
2. Add one nullable member marker and duplicate-safe snapshot reconciliation with focused data tests.
3. Add the total/bar-chart growth section, populated/empty design states, and component tests.
4. Run focused verification and Web typecheck; retain static populated/no-recent component proof after the user waives unavailable live browser screenshots.
5. Commit, open the PR, run the applicable review and CI gates, remediate accepted findings, and complete the handoff.

## Decisions

- Persist one content-free timestamp on the existing member row because a derived-only count would disappear after the 14-day message-retention window.
- Define a conversion as `first retained group message < first durable private member activation`; earlier private activations are excluded.
- Keep reconciliation on the existing growth snapshot path instead of adding an ingestion hot-path write or another scheduler.

## Verification

- Passed: Prisma validation, 59 focused Vitest tests for the projection/dashboard/component surface, Web typecheck, touched-file ESLint, repository diff/privacy inspection, and static production-component renders for recent and no-recent states.
- Review: final ReviewGPT rounds 1 and 2 passed with no findings. The preliminary pass was invalid without rendered artifacts; its two evidence-backed findings were accepted, corrected, and verified by the clean full-patch round 2. The user explicitly waived a screenshot-backed retry.
- CI: all required checks passed on the reviewed implementation head before this plan-only closure commit; GitHub will gate the exact final head again before merge.
Completed: 2026-08-25
