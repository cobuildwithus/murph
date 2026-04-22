Goal (incl. success criteria):
- Port the orphaned Finnish dry-sauna tranche1 source appraisals onto current main without replacing the newer full 93-source research landscape.
- Success means current main has protocolEvidence for the missing first-batch sauna source pages, the Health Commons generated catalog matches content, and the scoped change is committed.

Constraints/Assumptions:
- Preserve the current full dry-sauna researchLandscape on the protocol page.
- Do not reintroduce the old "Remaining corpus pending appraisal" group because current main already groups all displayed sources.
- Preserve unrelated worktree edits.

Key decisions:
- Treat the orphaned commit as source material, not as a cherry-pick target, because its protocol-level landscape is superseded by current main.

State:
- Ready to commit.

Done:
- Confirmed the tranche1 commit exists locally but is not an ancestor of main.
- Compared the supplied patch with the orphaned tranche1 branch.
- Ported 46 missing first-batch source appraisals and preserved the already-current appraisal for `pmid-31102597`.
- Regenerated Health Commons catalog outputs.
- Verified the full dry-sauna landscape still has 5 groups, 93 unique source keys, and 93 protocol appraisals.
- Verified with `pnpm typecheck`, `pnpm test:smoke`, `pnpm --dir packages/health-commons verify`, `pnpm --dir packages/health-commons test:coverage`, structural catalog checks, and `git diff --check`.

Now:
- Commit the scoped repair.

Next:
- Handoff with commit and verification summary.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- Orphaned commit: e11055ff
- `packages/health-commons/content/sources/sauna/*.md`
- `packages/health-commons/content/changes/2026-04.jsonl`
- `packages/health-commons/generated/{catalog.hash,catalog.json,entities.ndjson,recent-changes.json}`
Status: completed
Updated: 2026-04-22
Completed: 2026-04-22
