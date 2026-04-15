# Add frontend design audit workflow for apps/web UI changes

Status: completed
Created: 2026-04-15
Updated: 2026-04-15

## Goal

- Add a durable frontend-specific audit workflow for user-facing `apps/web` UI changes so agents must review the design system guidance before implementation and run a dedicated frontend review pass before handoff.

## Success criteria

- `AGENTS.md` requires product context in the always-read set and routes frontend UI work to the frontend guidance.
- The workflow docs define when the frontend audit applies and how it fits alongside existing audit passes.
- A reusable frontend audit prompt exists under `agent-docs/prompts/`.
- Truthful docs/process verification passes for the touched docs.

## Scope

- In scope:
  - `AGENTS.md`
  - workflow-routing and completion-workflow docs
  - frontend audit prompt docs
  - any matching durable doc index updates needed by the new prompt
- Out of scope:
  - implementing product UI changes
  - changing the current frontend design system itself

## Constraints

- Technical constraints:
  - Preserve unrelated worktree edits, including the existing `apps/web/next-env.d.ts` change.
- Product/process constraints:
  - Frontend audit should apply specifically to user-facing `apps/web` UI work, not every hosted-web backend change.
  - Keep the workflow additive and consistent with the existing coverage/simplify/task-finish-review model.

## Risks and mitigations

1. Risk: The new rule could be too broad and slow unrelated hosted-web work.
   Mitigation: Scope it to user-facing `apps/web` UI changes such as components, pages, and design-system-facing surfaces.
2. Risk: The docs could describe a new audit pass inconsistently across files.
   Mitigation: Update AGENTS, routing, completion workflow, and the audit prompt in the same landing.

## Tasks

1. Register the workflow-doc task in the coordination ledger.
2. Update `AGENTS.md` required reading and task routing for frontend work.
3. Update workflow routing and completion workflow to add a frontend audit pass.
4. Add a dedicated frontend audit prompt for the spawned review worker.
5. Run the truthful docs/process verification commands.
6. Commit and push the workflow update.

## Decisions

- Product context will mean `agent-docs/PRODUCT_SENSE.md` and `agent-docs/PRODUCT_CONSTITUTION.md` in `AGENTS.md`'s always-read set.
- The new frontend audit will be review-only and will sit alongside existing required audits rather than replacing them.

## Verification

- Commands to run:
- Expected outcomes:
  - `bash scripts/doc-gardening.sh --fail-on-issues`
  - direct readback of touched docs
  - expected outcomes: no doc-gardening issues and the workflow text stays internally consistent
Completed: 2026-04-15
