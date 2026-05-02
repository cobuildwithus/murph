# Almost-Done Research Groups

## Goal

Make the nearly complete Health Commons research tabs render grouped research sections by closing the remaining source/appraisal coverage gaps.

## Protocols

- Whole-body red and near-infrared light exposure
- Consistent wake time
- Tabata 20/10 interval training
- Digital sunset
- Morning outdoor light exposure

## Constraints

- Source-data fix only: prefer protocol Markdown `researchLandscape.groups` updates, with appraisal edits only if generated evidence proves a mismatch.
- Preserve unrelated active Health Commons, hosted-web, Cloudflare, and workflow dirty work.
- Use subagents with disjoint file ownership.

## Verification Target

- Each assigned route should expose non-empty `researchGroups` in generated research JSON.
- Health Commons generation/checks should pass, or unrelated blockers should be recorded.

## Outcome

- Landed scoped Health Commons source/appraisal coverage fixes in `ac8c8e6e2`, `cf8a64e4e`, and `2a653afa7`.
- Parent audit after regeneration found zero missing grouped display sources for all five routes.
- `pnpm --dir packages/health-commons verify` passed.
- `pnpm typecheck` passed.

Status: completed
Updated: 2026-05-02
Completed: 2026-05-02
