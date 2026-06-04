# Add deep review trigger to completion workflow

Status: completed
Created: 2026-06-03
Updated: 2026-06-03

## Goal

- Update the completion workflow so particularly complex or sensitive repo changes require an additional `deep-review` completion pass.

## Success criteria

- `agent-docs/operations/completion-workflow.md` describes when to add `deep-review`, how it is sequenced, and what handoff packet it receives.
- `agent-docs/operations/agent-workflow-routing.md` stays consistent with the completion workflow.
- Verification follows the docs/process-only lane and the plan is closed before handoff.

## Scope

- In scope:
- Durable operations docs for completion audit routing.
- Out of scope:
- Running an actual deep-review pass for this docs-only change.
- Changing audit prompt templates unless the workflow needs a new prompt file.

## Constraints

- Technical constraints:
- Preserve unrelated active ledger and dirty working-tree changes.
- Product/process constraints:
- Keep the workflow simple: `deep-review` is an extra pass for high-complexity or sensitive risk, not a default pass for every task.

## Risks and mitigations

1. Risk: The new rule overlaps confusingly with `security-privacy-review` or `task-finish-review`.
   Mitigation: State that `deep-review` is cross-cutting and does not replace required specialized or final passes.

## Tasks

1. Update completion workflow sequence, trigger conditions, worker rules, and handoff packet.
2. Update workflow routing references if needed for consistency.
3. Read back touched docs and run required verification.
4. Close the plan and create a scoped commit if unrelated dirty work allows it.

## Decisions

- Use no new prompt template unless the existing handoff packet is insufficient.

## Verification

- Commands to run:
- Read back touched docs.
- `pnpm typecheck`
- `git diff --check -- agent-docs/operations/completion-workflow.md agent-docs/operations/agent-workflow-routing.md agent-docs/exec-plans/active/2026-06-03-completion-deep-review.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- Expected outcomes:
- Docs describe the new rule without conflicting with existing audit requirements.
- Typecheck passes, or any failure is reported with scope and cause.

## Outcome

- Read back the touched workflow docs and confirmed the `deep-review` pass is conditional, review-only, sequenced before final completion review, and not a replacement for specialized required passes.
- `git diff --check` passed for the touched docs and active-plan files.
- `pnpm typecheck` passed.
- `pnpm test` was started, surfaced failures in unrelated runtime-state hosted bundle tests from the other active ledger scope, then was stopped after the user clarified tests were not needed for this docs-only change.
Completed: 2026-06-03
