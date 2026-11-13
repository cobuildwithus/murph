# Retire legacy Fitbit mailbox hint behind retained owner

Status: completed
Created: 2026-11-13
Updated: 2026-11-13

## Goal

- Let a restored runtime retire obsolete Fitbit migration successor hints already covered by an exact retained device-sync owner, while preserving provider jobs and retry deadlines.

## Success criteria

- A synthetic legacy hint no longer blocks the system-lane handled frontier when its same-epoch owner covers it.
- Unknown hints and unproven ownership remain ordering barriers.
- The assistant-runtime full suite, typecheck, and complexity check pass.
- Read-only incident evidence and remaining operational steps are documented outside the repository.

## Scope

- In scope: assistant-runtime legacy hint classification, a focused regression, and its reliability contract.
- Out of scope: production mutations, queue operations, and rollout.

## Constraints

- Technical constraints: reuse the existing retained-owner coverage and retirement path; keep exact source jobs and backoff unchanged.
- Product/process constraints: no direct identifiers or private production evidence in repository artifacts; commit locally and stop before push.

## Risks and mitigations

1. Risk: retiring a wake could discard unprocessed work.
   Mitigation: recognize only the retired migration successor hint, which carried no job or scope and returned a retryable Web admission; require all existing same-owner, epoch, status, and retry checks.

## Tasks

1. Prove the old producer and current runtime classifier against read-only evidence.
2. Add the focused synthetic regression and smallest runtime compatibility change.
3. Run focused and full assistant-runtime verification, typecheck, complexity, review the diff, and commit.
4. Write the external incident report with rollout and recovery limits.

## Decisions

- The legacy migration hint is an obsolete readiness nudge, not canonical dirty work; its original Web path returned a retryable error after appending the wake.

## Verification

- Focused Vitest regression failed on the released code, then passed for both the legacy and unknown reasons after the change.
- `pnpm --dir packages/assistant-runtime test:coverage`: passed, with statement coverage 91.78%, branch coverage 87.69%, function coverage 95.3%, and line coverage 92.21%.
- `pnpm --dir packages/assistant-runtime typecheck`: passed.
- `pnpm complexity:diff`: passed, with no complexity increase.
- `git diff --check`: passed.
- Read-only incident findings and the remaining rollout/recovery steps are in the external incident report. No production mutation or queue action was performed.
- No public changelog entry: the change corrects an internal mailbox recovery path and does not change member-visible product behavior.
Completed: 2026-11-13
