# PR 558 ReviewGPT Round 7 Remediation

Status: completed
Created: 2026-07-14
Updated: 2026-07-14

## Goal

- Validate and remediate the four exact-head ReviewGPT findings for PR 558 while preserving self-service hosted-group leave behavior and its durable-state invariants.

## Success criteria

- Join confirmations validate against the persisted membership epoch.
- Retention-only system imports run post-checkpoint effects only after a durable checkpoint.
- Terminal unresolved leave evidence remains decryptable and replay-safe without mutating encryption-associated metadata.
- Group membership listings exclude departed memberships and departed member counts.
- Focused tests, affected typechecks, required CI, and a fresh exact-head ReviewGPT audit pass.

## Scope

- In scope: PR 558 group membership, leave replay/evidence, join confirmation, retention import behavior, focused tests, and directly required durable schema/docs.
- Out of scope: PRs 542 and 573, hosted-local assistant stub scoping, unrelated main changes, and merging the PR.

## Constraints

- Preserve existing user-critical group join/leave and mailbox flows.
- Prefer existing durable owners and the smallest maintainable correction.
- Do not alter separately owned hosted-local E2E harness files.
- Push only after verifying the live remote PR head, then run ReviewGPT concurrently with CI.

## Risks and mitigations

1. Risk: replay disposition becomes coupled to encrypted evidence metadata.
   Mitigation: keep encryption AAD immutable and persist terminal disposition separately.
2. Risk: confirmation or cleanup effects run before their owning state is durable.
   Mitigation: derive epochs from committed rows and run effects only after checkpoint success.

## Tasks

1. Prove or reject each round-7 finding against the current implementation and invariants.
2. Implement minimal fixes and focused regressions for accepted findings.
3. Run focused tests, affected typechecks, diff verification, and privacy/diff checks.
4. Finish the plan, commit, reconcile latest main, guarded-push, and start CI plus exact-head ReviewGPT concurrently.
5. Validate audit findings and complete all merge-readiness gates.

## Decisions

- The round-7 response is evidence to validate, not an instruction to add new architecture.
- Main advanced only through unrelated usage-notice work at plan creation; no base-only ReviewGPT rerun is required.

## Verification

- Focused Web, assistant-runtime, assistant-engine, and hosted-execution tests covering changed paths.
- Relevant package typechecks and repository diff verification.
- GitHub required checks on the pushed exact head.
- ReviewGPT 0.5.106 Pro/current, 120-minute exact-PR-head audit with `REVIEW_COMPLETE`.
Completed: 2026-07-14
