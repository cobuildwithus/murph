# Land experiment protocol UI patch

Status: completed
Created: 2026-04-21
Updated: 2026-04-21

## Goal

- Land the supplied experiment-protocol UI patch so experiment detail pages show protocol variants as structured recipes with at-a-glance metadata, cleaner step instructions, dedicated `whyItWorks` copy, and regenerated Health Commons artifacts that stay schema-valid and hash-consistent.

## Success criteria

- The supplied patch lands cleanly in the intended `apps/web`, contracts, and Health Commons files without widening scope.
- The experiment detail UI exposes the new protocol metadata and sectioned recipe content without regressing the existing safety, research, or expert sections.
- The Health Commons protocol schema and generated artifacts stay internally consistent and the touched content files parse.
- Required scoped verification and required completion-workflow review passes complete, or any unrelated blocker is documented precisely.
- The task closes with a scoped commit through the repo-approved plan workflow.

## Scope

- In scope:
- `apps/web/src/components/experiments/experiment-detail/protocol-tab.tsx`
- `apps/web/src/lib/health-commons/experiment-detail.ts`
- `apps/web/src/types/experiments.ts`
- `packages/contracts/src/health-commons.ts`
- The supplied Health Commons protocol content and generated artifact files touched by the patch
- Out of scope:
- Unrelated `apps/web` onboarding or hosted execution work
- Broader Health Commons schema redesign outside the supplied protocol fields
- New experiments or unrelated catalog regeneration beyond the patch slice

## Constraints

- Technical constraints:
- Preserve existing repo design-system and Health Commons ownership boundaries.
- Treat the supplied patch as intent, not overwrite authority; inspect the landed diff for drift.
- Product/process constraints:
- Follow the standard repo-change workflow, including ledger/plan handling, scoped verification, required `frontend-review`, `coverage-write`, and `task-finish-review` passes, then a scoped commit.
- Preserve unrelated worktree edits.

## Risks and mitigations

1. Risk: The patch could land structurally but drift from the current experiment-detail UI or Health Commons schema expectations.
   Mitigation: Review the touched files before and after apply, then run scoped verification on the affected surfaces.

2. Risk: Generated Health Commons artifacts could be stale relative to the content/schema changes.
   Mitigation: Verify the touched Health Commons slice and confirm the generated catalog artifacts in the patch remain valid.

3. Risk: The repo workflow requires completion reviews beyond a simple patch apply.
   Mitigation: Run the required audit passes before commit and only hand off after the scoped completion path is satisfied.

## Tasks

1. Register the task in the coordination ledger and finalize this execution plan.
2. Apply the supplied patch and inspect the resulting diff for unexpected drift.
3. Run truthful scoped verification for the touched `apps/web` and Health Commons surfaces.
4. Run the required completion-workflow audit passes and address any findings.
5. Finish the plan-bearing task with a scoped commit and handoff.

## Decisions

- Treat this as a plan-bearing standard repo change even though it arrives as a supplied patch, because it spans multiple repo areas and requires the full completion workflow.

## Verification

- Commands to run:
- `pnpm test:diff apps/web/src/components/experiments/experiment-detail/protocol-tab.tsx apps/web/src/lib/health-commons/experiment-detail.ts apps/web/src/types/experiments.ts packages/contracts/src/health-commons.ts packages/health-commons/content/protocols/dry-sauna/bryan-johnson-blueprint.md packages/health-commons/content/protocols/dry-sauna/murph-finnish-standard-3x-week.md packages/health-commons/content/protocols/norwegian-4x4/norwegian-4x4.md packages/health-commons/content/protocols/red-light-glasses-before-bed/red-light-glasses-before-bed.md packages/health-commons/content/changes/2026-04.jsonl packages/health-commons/generated/catalog.hash packages/health-commons/generated/catalog.json packages/health-commons/generated/entities.ndjson packages/health-commons/generated/recent-changes.json`
- Any narrower direct Health Commons parse/hash command needed if the diff-aware lane does not fully prove the generated slice
- Expected outcomes:
- The touched `apps/web` lane and directly coupled package/content checks pass, or any unrelated pre-existing blocker is explicitly identified.
- The landed patch preserves valid generated Health Commons outputs for the touched experiments.
Completed: 2026-04-21
