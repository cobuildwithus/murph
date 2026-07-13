# PR 528 final audit corrections

Status: completed
Created: 2026-07-12
Updated: 2026-07-12

## Goal

- Close the sole final PR #528 audit findings without weakening hosted reminder recovery: derive legacy personal-home authority from accepted direct Linq input evidence, commit the complete repair atomically, and keep newly discovered pending conversation work ahead of managed reconciliation.

## Success criteria

- Ambiguous managed rows and group evidence never authorize a personal current-home migration.
- Confirmed direct legacy targets migrate all active/paused exact-target bare routes in one canonical batch; archived, grouped, and unrelated routes remain unchanged.
- A hosted persistence failure rolls back the entire route repair, and retry repairs the complete set.
- Pending input discovered after system-mailbox preparation skips managed reconciliation and immediately enters the assistant lane.
- Focused tests, owner typechecks/coverage, required audits, exact-head CI, and unresolved-thread checks pass.

## Scope

- In scope: core automation registry repair, managed-automation route proof, hosted assistant-phase ordering, focused tests, deliverability documentation, PR evidence.
- Out of scope: new route state, scheduler/queue changes, group-route fallback, frontend behavior, rerunning ReviewGPT for unrelated base changes.

## Constraints

- Technical constraints: preserve package dependency direction; use one canonical WriteBatch under the registry owner lock; add no persisted authority marker beyond the existing route fields.
- Product/process constraints: preserve foreground priority, keep ambiguous/group routes fail-closed, use exactly the already-completed final ReviewGPT audit, and keep heavy verification serial.

## Risks and mitigations

1. Risk: mutable automation rows misclassify a legacy group target as personal.
   Mitigation: accept only a fresh direct current route or immutable accepted Linq input with direct-conversation metadata and its authorized Linq reply target.
2. Risk: interruption persists only a prefix and consumes the migration precondition.
   Mitigation: derive the complete set under the owner lock and stage every document plus one audit in a single canonical batch.
3. Risk: background reconciliation delays a newly visible accepted conversation.
   Mitigation: guard managed reconciliation with the latest post-maintenance pending-input result while retaining live-yield behavior.

## Tasks

1. Implement and prove direct-route authority plus atomic complete-set repair.
2. Correct post-mailbox pending-input ordering and focused coverage.
3. Run required verification and audit resolution.
4. Commit, push, wait exact-head CI, resolve threads, and reconfirm merge readiness.

## Decisions

- Accepted all three final-audit findings after tracing their production paths.
- Rejected deletion-only remediation because it would leave the user-critical legacy reminder flow broken.
- Use accepted provider-ingested Linq input events as former-home proof; managed records are consistency data only and never authority.

## Verification

- Focused core, assistant-engine, and assistant-runtime test files passed with one worker: 15, 19, and 210 tests respectively.
- Core, assistant-engine, and assistant-runtime typechecks passed.
- Full owner coverage passed serially: core 600 tests; assistant-engine 2,045 tests with four skips; assistant-runtime 1,526 tests with two skips.
- Scenario integrity passed for 205 scenarios, 11 sample inputs, and 28 golden directories.
- Logging, dependency, documentation-drift, whitespace, stale-symbol, privacy, and secret guards passed.
- Parent security/privacy, coverage, and final diff review found no remaining actionable issue. The required specialist-helper readiness signal was emitted; no helper was launched without the controller grant.
- Pending remote outcomes: scoped commit/push, current-base reconciliation, exact-head CI, unresolved-thread confirmation, and merge-readiness confirmation.
Completed: 2026-07-12
