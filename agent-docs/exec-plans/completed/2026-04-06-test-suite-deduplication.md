# Reduce duplicated test and harness code across major repo seams

Status: completed
Created: 2026-04-06
Updated: 2026-04-06

## Goal

- Reduce meaningful duplicated setup/assertion/harness code across the repo's major test seams while preserving behavior and keeping ownership boundaries clear.

## Success criteria

- The major test seams each get a focused duplication review by a dedicated worker.
- High-value duplicated helpers/setup logic in touched seams are consolidated into existing or newly justified local test helpers.
- Touched suites still read clearly and keep seam-local behavior explicit instead of moving everything into opaque shared abstractions.
- Required repo verification for touched surfaces passes, or any unrelated blocker is identified precisely.
- Required final audit review runs before handoff.

## Scope

- In scope:
  - Test and harness refactors in `apps/web/test/**`, `apps/cloudflare/test/**`, `packages/cli/test/**`, `packages/assistant-core/test/**`, `packages/assistant-runtime/test/**`, and other package-local test directories where duplication is worth reducing.
  - Supporting test-helper changes that stay scoped to the owning seam.
  - Narrow verification/doc updates only if a refactor changes durable test workflow expectations.
- Out of scope:
  - Product/runtime behavior changes unrelated to test deduplication.
  - Broad production-code abstractions created solely to satisfy tests.
  - Reverting or reshaping unrelated in-flight work already present in the tree.

## Constraints

- Technical constraints:
  - Preserve existing behavior and test intent while reducing duplication.
  - Prefer seam-local helpers over cross-package test utility grab-bags unless duplication truly crosses ownership boundaries.
  - Respect existing dirty worktree edits and keep worker write scopes disjoint.
- Product/process constraints:
  - Use one worker subagent per large seam as requested.
  - Run required verification and the required final audit subagent.
  - Create a scoped commit if repo files are changed and verification is complete or unrelated blockers are documented.

## Risks and mitigations

1. Risk: Workers converge on the same helper files and create merge friction.
   Mitigation: Assign disjoint ownership per seam and keep any shared-helper integration in the main agent lane.
2. Risk: Deduplication hides test intent behind over-abstracted helpers.
   Mitigation: Only consolidate repeated mechanics; keep scenario-specific setup/assertions inline.
3. Risk: Existing unrelated branch changes break repo-wide checks.
   Mitigation: Record current worktree state up front, run the required baseline, and document any unrelated blocker precisely if it appears.

## Tasks

1. Review test topology and identify large seams with meaningful duplication candidates.
2. Spawn one worker per large seam with explicit file ownership and deduplication goals.
3. Integrate worker patches and add any small follow-up refactors needed for consistency.
4. Run required verification for the touched repo surfaces.
5. Run the required final audit review, address findings, and finish with a scoped commit.

## Decisions

- Use seam-local helper consolidation first; only extract cross-seam helpers when duplication is clearly shared and the ownership boundary supports it.
- Treat the work as a standard cross-cutting repo change with an active execution plan and coordination-ledger tracking.

## Verification

- Commands to run:
  - `pnpm typecheck`
  - `pnpm test:coverage`
- Expected outcomes:
  - Typecheck and repo acceptance pass for the touched test refactors, or any unrelated pre-existing blocker is called out with exact failing targets.
Completed: 2026-04-06
