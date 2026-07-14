# Simplify hosted mailbox receipt ordering

Status: completed
Created: 2026-07-14
Updated: 2026-07-14

## Goal

- Prevent hosted workspace restore failures after mailbox-backed canonical writes by making the workspace runner the sole receipt-protected mailbox mutation owner.
- Preserve prompt foreground processing, strict receipt replay validation, and the existing atomic receipt-plus-watermark checkpoint while deleting outer import orchestration and duplicated state bookkeeping.

## Success criteria

- No outer hosted-runtime scheduling path mutates canonical workspace state.
- Every mailbox canonical write enters through the runner-owned protected import path.
- A late pre-checkpoint mailbox canonical write publishes its receipt and imported watermark together before any later canonical write can depend on it.
- A receipt checkpoint failure rolls back the canonical write and leaves mailbox progress unchanged.
- Focused regression coverage, the required verification lane, security/privacy review, coverage audit, parent final review, green PR CI, and a zero-accepted-finding ReviewGPT round all pass on the final pushed head.

## Scope

- In scope:
  - Hosted mailbox foreground scheduling/import ownership in `packages/assistant-runtime`.
  - Canonical receipt versus mailbox-watermark ordering at the runner ownership boundary.
  - Focused unit/integration regression coverage and current hosted-runtime protocol documentation.
- Out of scope:
  - Automatic repair of already inconsistent production workspaces.
  - New queues, recovery services, persisted state, compatibility shims, or relaxed receipt replay validation.
  - Web schema, provider ingress, WHOOP integration, or unrelated mailbox consumption work.

## Constraints

- Technical constraints:
  - Keep one mailbox mutation owner and the existing canonical receipt primitive.
  - Preserve foreground conversation priority, write-lock/rollback semantics, atomic mailbox receipt/progress publication, and fail-closed base validation.
- Product/process constraints:
  - Default to deletion and avoid speculative recovery machinery.
  - Work only in the isolated task worktree and preserve overlapping ledger work.
  - Open a PR and complete the repository ReviewGPT loop after local completion gates.

## Risks and mitigations

1. Risk: simplifying the outer foreground loop could delay newly arrived conversation input or starve checkpoint work.
   Mitigation: retain read-only wake/prefetch discrimination and existing runner-owned foreground priority, with focused ordering tests.
2. Risk: moving the import boundary could accidentally consume the normal mailbox budget for late foreground conversation input.
   Mitigation: expose the existing foreground importer only for the runner's initial wake import; keep system and startup imports on their current budgeted path.
3. Risk: overlapping mailbox work changes the same large runtime file.
   Mitigation: stay on current `origin/main`, keep the diff limited to receipt/import ownership, inspect upstream before every push, and resolve only task-relevant conflicts.

## Tasks

1. Reproduce and pin the unreceipted outer mailbox import with a production-faithful focused regression.
2. Delete outer canonical mutation and duplicated deferred bookkeeping; route wake imports through the runner's existing protected mailbox path.
3. Update focused receipt-ordering tests and clarify the hosted-runtime protocol ownership contract.
4. Run required scoped verification, direct scenario proof, security/privacy review, coverage-write audit, and parent final review.
5. Close the plan through `scripts/finish-task`, push, open the intent-complete PR, run ReviewGPT with CI, and resolve accepted findings to completion.

## Decisions

- Keep the canonical receipt log and strict replay base checks; they are required crash durability and corruption detection, not defensive complexity to remove.
- Keep the mailbox-specific receipt-plus-watermark checkpoint. The audit found that deleting it would require proving idempotent replay across every mailbox kind, which is not necessary to fix the current, proven bypass.

## Verification

- Commands to run:
  - Focused Vitest runs for workspace runner, mailbox checkpoint, and workspace entrypoint receipt/import scenarios during iteration.
  - `pnpm test:diff packages/assistant-runtime agent-docs/references/hosted-runtime-protocol.md`
  - Direct late-wake regression proving a real mailbox canonical write receives a durable receipt before the following foreground write.
  - Required local security/privacy review and coverage-write audit.
  - PR CI, mergeability preflight, and `pnpm review:gpt pr-review` rounds on each PR-specific pushed head until zero accepted findings.
- Expected outcomes:
  - All required checks pass without new state, dependencies, services, recovery branches, or weakened restore validation.

### Results

- `pnpm test:diff packages/assistant-runtime agent-docs/references/hosted-runtime-protocol.md` passed on the rebased shared-host profile: 1,609 package tests passed with 2 skipped; 1,781 Cloudflare Node tests and the Workers smoke test passed.
- The complete hosted-runtime entrypoint file passed all 208 tests, including direct cold-restore receipt ordering, retained shutdown import/effect preservation, and empty-import held-wake reconciliation.
- The required `coverage-write` audit found no missing proof and made no edits.
- Parent final review found no remaining scope, ownership, privacy, or proof gap.
Completed: 2026-07-14
