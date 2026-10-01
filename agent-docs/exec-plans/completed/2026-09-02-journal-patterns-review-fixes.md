# Journal and Personal Patterns review fixes

## Goal

Close the blocking and high-value findings from the independent Journal and
Personal Patterns review. Keep the current product design and use the existing
projection, browser replica, group tool, and private Journal owners.

## Product UX

- Group Journal capture must work through the hosted wire boundary.
- Consent must come before any private clarification from a group message.
- The Journal must use the browser's local day and show direct numeric data.
- Desktop and mobile must explain the same seven-day summary window.
- Fixture copy must not depend on hidden production tag rules.
- Manual activities must not create false implicit absence evidence.

## Scope

- Hosted group request and response parsing.
- Current-sender Journal consent ordering.
- Journal projection date range and structured metrics.
- Journal seven-day caption and local-day behavior.
- Personal Patterns device provenance rule.
- Focused regression tests, live assistant proof, and rendered UI proof.

## Constraints

- Do not add a queue, service, consent store, or new UI framework.
- Do not retain later group facts while consent is pending.
- Preserve existing data ownership and private-write boundaries.
- Preserve unrelated worktree files.

## Tasks

- [x] Parse every group Journal action at the hosted route boundary.
- [x] Gate ambiguous group facts behind prior consent.
- [x] Widen the Journal projection for positive local time zones.
- [x] Add structured Journal metrics and remove UI prose parsing.
- [x] Show the seven-day caption on desktop and mobile.
- [x] Remove fixture-only Journal summary suppression.
- [x] Limit implicit absence to device-backed activity evidence.
- [x] Run focused tests, the real-Codex journey, and responsive UI proof.
- [x] Ask Fable 5.1 to confirm the fixes on the final candidate.

## Verification

- Focused hosted-execution, Web, Query, contracts, and assistant tests.
- Focused real-Codex group Journal journey.
- Type checks for changed packages.
- Browser proof for Journal desktop and mobile states.
- Required ReviewGPT and GitHub checks before completion.

## Deployment

Deploy the browser-replica reader before the producer when the replica
generation changes. Confirm the hosted group route accepts the three Journal
actions after deployment.
Status: completed
Updated: 2026-09-02
Completed: 2026-09-02
