# Land the stale Norwegian 4x4 research-improvements patch on current HEAD

Status: completed
Created: 2026-04-22
Updated: 2026-04-22

## Goal

- Land the supplied Norwegian 4x4 research-improvements patch on current HEAD by porting its intended Health Commons content, hosted-web research UI, and directly coupled generated catalog changes without widening into unrelated experiment-detail or Health Commons work.

## Success criteria

- The Norwegian 4x4 family, protocol, and source pages reflect the tighter evidence framing and clearer layer separation from the supplied patch.
- The hosted-web research UI reflects the improved Norwegian 4x4 research readability changes from the supplied patch.
- The directly coupled `packages/health-commons/generated/**` artifacts are regenerated from the landed authored content and remain internally consistent.
- The truthful scoped verification commands for the touched owners pass, or any unrelated pre-existing blocker is identified precisely.
- Required completion-workflow audit passes run before handoff.

## Scope

- In scope:
- `apps/web/src/components/experiments/experiment-detail/{protocol-tab,study-card}.tsx`
- `apps/web/src/lib/health-commons/experiment-detail.ts`
- `packages/health-commons/content/changes/2026-04.jsonl`
- `packages/health-commons/content/families/norwegian-4x4.md`
- `packages/health-commons/content/protocols/norwegian-4x4/norwegian-4x4.md`
- `packages/health-commons/content/sources/norwegian-4x4/**`
- Directly coupled `packages/health-commons/generated/{catalog.hash,catalog.json,entities.ndjson,recent-changes.json}`
- Plan and coordination-ledger artifacts required for this landing
- Out of scope:
- Unrelated hosted-web experiment-detail layout work already in flight
- Other Health Commons families, protocols, or source corpora
- Runtime, schema, or product-behavior changes outside the supplied Norwegian 4x4 research/readability intent

## Constraints

- Technical constraints:
- Preserve unrelated dirty-tree edits and prior in-flight rows.
- Treat the supplied patch as intent, not overwrite authority; port stale hunks onto current file layouts manually where needed.
- Regenerate generated artifacts from the landed authored content instead of force-applying stale generated blobs.
- Product/process constraints:
- Follow the standard repo-change completion workflow, including `frontend-review`, `coverage-write`, and `task-finish-review`.
- Use `scripts/finish-task` for the final scoped commit while this active plan exists.

## Risks and mitigations

1. Risk: The stale patch collides with current study-card layout and Norwegian source prose changes.
   Mitigation: Read current files side by side with the patch and port only the requested behavior and copy shifts.
2. Risk: Generated Health Commons artifacts may drift from the authored content if patched directly.
   Mitigation: Regenerate them from source and verify with the package's `generate:check` path.
3. Risk: Scoped verification could be obscured by unrelated dirty-tree failures.
   Mitigation: Prefer `bash scripts/workspace-verify.sh test:diff <path ...>` for task-only targeting and supplement with owner-level focused commands when that is the more truthful proof.

## Tasks

1. Register this lane in the coordination ledger.
2. Port the stale supplied patch onto current HEAD across the in-scope authored files.
3. Regenerate the directly coupled Health Commons generated artifacts.
4. Run the truthful scoped verification commands for `apps/web` and `packages/health-commons`.
5. Run required completion-workflow audit passes, apply any needed follow-up fixes, and finish with a scoped commit.

## Decisions

- This is a follow-on completion lane to the earlier partial Norwegian stale-patch landing that intentionally excluded shared generated artifacts and the remaining research UI changes.
- Generated artifacts will be rebuilt from the current authored state rather than patched from the stale blob in the supplied patch file.

## Verification

- Commands to run:
- `pnpm typecheck`
- `bash scripts/workspace-verify.sh test:diff apps/web/src/components/experiments/experiment-detail/protocol-tab.tsx apps/web/src/components/experiments/experiment-detail/study-card.tsx apps/web/src/lib/health-commons/experiment-detail.ts packages/health-commons/content/changes/2026-04.jsonl packages/health-commons/content/families/norwegian-4x4.md packages/health-commons/content/protocols/norwegian-4x4/norwegian-4x4.md packages/health-commons/content/sources/norwegian-4x4 packages/health-commons/generated/catalog.hash packages/health-commons/generated/catalog.json packages/health-commons/generated/entities.ndjson packages/health-commons/generated/recent-changes.json`
- `pnpm --dir packages/health-commons verify`
- `pnpm --dir apps/web lint`
- `pnpm --dir apps/web exec vitest run test/study-card.test.ts test/health-commons-experiment-detail-page.test.ts --config vitest.config.ts --no-coverage`
- `pnpm test:smoke`
- Expected outcomes:
- The scoped diff-aware lane and focused owner/package checks pass, or any unrelated pre-existing failure is documented precisely enough for handoff.
Completed: 2026-04-22
