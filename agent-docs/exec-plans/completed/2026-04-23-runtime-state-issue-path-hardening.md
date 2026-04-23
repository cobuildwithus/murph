# Harden assistant runtime issue pending-path resolution

Status: completed
Created: 2026-04-23
Updated: 2026-04-23

## Goal

- Prevent crafted assistant runtime issue ids from influencing on-disk pending-issue paths so exported path resolution and deletion stay confined to `issues/pending`.

## Success criteria

- `resolvePendingAssistantRuntimeIssuePath()` validates `issueId` with the canonical runtime-issue id parser before constructing the filename.
- `deletePendingAssistantRuntimeIssueRecord()` fails closed on invalid `issueId` inputs and cannot delete files outside `issues/pending`.
- Focused tests cover the malicious-id rejection path and prove a sibling assistant-runtime file is not deleted.
- Required high-risk verification, direct proof, and completion audits are recorded before handoff.

## Scope

- In scope:
- `packages/runtime-state/src/assistant-runtime-issues.ts`
- directly coupled `packages/runtime-state/test/assistant-runtime-issues.test.ts`
- `agent-docs/exec-plans/active/{2026-04-23-runtime-state-issue-path-hardening.md,COORDINATION_LEDGER.md}`
- Out of scope:
- broader assistant-runtime issue schema redesign or filename encoding changes beyond what is needed to close the path-resolution bug
- unrelated dirty `packages/runtime-state/test/assistant-usage*.test.ts` work already in progress in this tree
- downstream hosted-runtime behavior outside the runtime-state helper contract

## Constraints

- Technical constraints:
- Keep the existing on-disk issue filename format `<issueId>.json` for valid ids.
- Use the existing canonical `normalizeIssueId()` boundary rather than adding a second divergent validation rule.
- Product/process constraints:
- Treat this as a high-risk trust-boundary fix and follow the repo’s plan, ledger, verification, and audit workflow.
- Preserve unrelated dirty-tree edits, especially the existing `assistant-usage` test changes under `packages/runtime-state/test`.

## Risks and mitigations

1. Risk: fixing only the delete call could leave the exported path resolver exploitable for future callers.
   Mitigation: make `resolvePendingAssistantRuntimeIssuePath()` itself validate the `issueId` so all callers inherit the boundary.
2. Risk: a too-broad hardening change could alter filename compatibility for already-persisted valid issue ids.
   Mitigation: keep the `<issueId>.json` format unchanged and only reject ids that already violate the canonical id contract.

## Tasks

1. Completed: classify the task, read the required repo workflow/security docs, inspect the runtime-state issue helper, and confirm the target seam is clean enough to edit.
2. Completed: create this execution plan and register the task in `COORDINATION_LEDGER.md`.
3. Completed: harden the runtime-state pending-issue path helper to validate ids before path construction and extend focused regression coverage for malicious ids.
4. Completed: run the required verification commands, capture direct proof, and complete the mandatory `coverage-write` and `task-finish-review` audit passes.
5. Completed: assess the scoped commit workflow; no exact task-only commit is possible because the shared dirty `COORDINATION_LEDGER.md` would absorb unrelated concurrent edits.

## Decisions

- The correct owner boundary is `resolvePendingAssistantRuntimeIssuePath()`, not only the delete wrapper, because that exported helper is the shared filename constructor.
- The fix should reuse `normalizeIssueId()` instead of inventing a second sanitizer or changing persisted filenames.

## Verification

- Commands to run:
- `pnpm typecheck`
- `bash scripts/workspace-verify.sh test:diff packages/runtime-state/src/assistant-runtime-issues.ts packages/runtime-state/test/assistant-runtime-issues.test.ts`
- `pnpm test:smoke`
- `pnpm --dir packages/runtime-state typecheck`
- `pnpm --dir packages/runtime-state test:coverage`
- `pnpm --dir packages/runtime-state exec vitest run test/assistant-runtime-issues.test.ts --config vitest.config.ts --no-coverage`
- direct scenario proof for malicious-id rejection on the pending-issue path/delete seam
- `git diff --check`
- required `coverage-write` and `task-finish-review` audit passes
- Expected outcomes:
- Invalid `issueId` values fail closed before path resolution.
- A crafted delete input cannot remove files outside `issues/pending`.
- Valid issue ids continue to read/write/delete using the existing filename format.
- Actual results:
- Failed for unrelated pre-existing reasons: `pnpm typecheck`
  - `packages/core/src/operations/write-batch.ts`: existing `result` unknown-type errors
  - `packages/device-syncd/src/providers/whoop.ts`: existing `readonly` modifier error
- Failed for unrelated pre-existing reasons: `bash scripts/workspace-verify.sh test:diff packages/runtime-state/src/assistant-runtime-issues.ts packages/runtime-state/test/assistant-runtime-issues.test.ts`
  - broadened to reverse dependents and hit unrelated branch churn in `packages/assistant-cli`, `packages/core`, `packages/device-syncd`, `packages/inbox-services`, and `packages/query`
- Passed: `pnpm --dir packages/runtime-state typecheck`
- Passed: `pnpm --dir packages/runtime-state test:coverage`
- Passed: `pnpm --dir packages/runtime-state exec vitest run test/assistant-runtime-issues.test.ts --config vitest.config.ts --no-coverage`
- Passed: `pnpm test:smoke`
- Passed: `git diff --check -- packages/runtime-state/src/assistant-runtime-issues.ts packages/runtime-state/test/assistant-runtime-issues.test.ts agent-docs/exec-plans/active/2026-04-23-runtime-state-issue-path-hardening.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- Passed direct scenario proof: a `tsx` script showed both `resolvePendingAssistantRuntimeIssuePath(paths, "../../status")` and `deletePendingAssistantRuntimeIssueRecord({ issueId: "../../status", paths })` throw `issueId must match the assistant runtime issue id format.`, while a sibling `status.json` remained intact and a valid pending issue path continued to resolve under `issues/pending`.

## Outcome

- Implemented in the shared worktree. The exported pending-issue path helper now enforces the canonical issue-id contract before constructing filenames, so the delete path fails closed on traversal-shaped inputs without changing valid persisted filenames.

## Audits

- `coverage-write` (`gpt-5.4-mini`): no additional write needed; existing regression plus package-local coverage already prove the boundary.
- `task-finish-review`: no findings in scope; reviewer agreed the shared exported path constructor is the correct owner boundary and the new regression covers the trust-boundary case.

## Commit note

- No scoped commit was created because `scripts/finish-task` would need to include the shared dirty `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`, which currently contains unrelated concurrent edits outside this task.
Completed: 2026-04-23
