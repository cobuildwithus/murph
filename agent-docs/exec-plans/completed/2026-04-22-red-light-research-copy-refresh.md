# Red-light glasses research copy refresh

Status: completed
Created: 2026-04-22
Updated: 2026-04-22

## Goal

- Land the supplied red-light-glasses research/copy refresh onto current HEAD without widening beyond the requested study-card wording/layout adjustments, red-light protocol/source copy, and directly coupled data snapshots when required.

## Success criteria

- The study card uses the clearer evidence labels and layout tweaks from the supplied patch.
- The red-light protocol and source markdown reflect the tighter claim framing, null-result normalization, and product-fit guidance from the supplied patch.
- Any directly coupled data snapshot needed by the current runtime/tests is updated consistently.
- Required verification and completion audits run, or any unrelated blocker is named precisely.
- A scoped commit includes only this lane's files plus plan/ledger closeout.

## Scope

- In scope: `apps/web/src/components/experiments/experiment-detail/study-card.tsx`, `packages/health-commons/content/protocols/red-light-glasses-before-bed/red-light-glasses-before-bed.md`, `packages/health-commons/content/sources/red-light-glasses-before-bed/**`, `health-commons-corpus-summary.json`, and directly coupled generated outputs only if verification proves they must change in the same landing.
- Out of scope: schema changes, onboarding contract changes, broad generated-catalog refreshes unrelated to this content slice, unrelated experiment-detail projection work, and unrelated hosted/runtime dirty-tree work.

## Constraints

- Preserve unrelated working-tree edits already present in this checkout.
- Prefer merging the supplied intent onto current file contents instead of replaying stale hunks mechanically.
- Keep commit content privacy-safe and avoid exposing local identifiers.

## Tasks

1. [x] Register the active lane in the coordination ledger.
2. [x] Merge the supplied copy/layout updates into the target files.
3. [x] Regenerate or refresh directly coupled snapshots only if the current runtime/tests require them.
4. [x] Run scoped verification and required completion audits.
5. [ ] Create a scoped commit and close out the plan.

## Verification

- `pnpm exec vitest run --config apps/web/vitest.workspace.ts apps/web/test/study-card.test.ts`
- `pnpm exec vitest run --config apps/web/vitest.workspace.ts apps/web/test/experiment-detail-protocol-tab.test.ts`
- `pnpm --dir packages/health-commons verify`
- `pnpm typecheck`
- `git diff --check`

## Notes

- The supplied patch referenced `health-commons-corpus-summary.json`, but that file does not exist in current HEAD. I mapped the intended corpus-stat additions onto the current red-light protocol/bibliography frontmatter instead of inventing a new summary file.
- The supplied hunks for `pmid-41421618` and `pmid-41565717` were intentionally not applied because those identifiers now point to different source pages in current HEAD; replaying the pasted copy would have made those records less accurate.
- Regenerating `packages/health-commons/generated/*` also refreshed a small stale-output slice for already-authored Norwegian 4x4 onboarding content, because the committed source content was ahead of the generated catalog.
- `pnpm typecheck` is still red for unrelated existing app work in `apps/web/src/lib/hosted-execution/usage.ts` and `apps/web/test/hosted-execution-stripe-metering.test.ts`.
- `pnpm exec vitest run --config apps/web/vitest.workspace.ts apps/web/test/health-commons-experiment-detail-page.test.ts` is still red for an unrelated Bryan Johnson expectations drift.
Completed: 2026-04-22
