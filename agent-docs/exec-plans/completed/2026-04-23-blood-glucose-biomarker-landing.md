# Blood glucose biomarker landing

Status: completed
Created: 2026-04-23
Updated: 2026-04-23

## Goal

- Land the supplied blood glucose biomarker Health Commons patch so the new public biomarker page, supporting sources, generated catalog updates, and browser-vault glucose projection all integrate cleanly on current `HEAD`.

## Success criteria

- The blood glucose biomarker markdown page and supporting source artifacts are present under `packages/health-commons/content/**`.
- The browser-vault query projection accepts imported glucose samples in `mg_dL` and maps them into the expected private `body_state:glucose` metric rows.
- Directly required generated Health Commons artifacts are current and scoped to the landed content.
- Scoped verification and mandatory audit passes complete, or any unrelated blocker is named precisely.
- A scoped commit contains only the task-owned files plus plan and ledger closeout.

## Scope

- In scope: the supplied blood glucose biomarker/source content files, the 2026-04 Health Commons change record entry, directly required generated Health Commons artifacts, the query/browser-replica glucose projection update, plan/ledger bookkeeping, and minimal current-`HEAD` porting if the patch no longer applies cleanly.
- Out of scope: unrelated Health Commons content refreshes, other active biomarker landings, schema changes, broader query refactors, and any unrelated dirty-tree work elsewhere in the repo.

## Constraints

- Technical constraints: preserve existing Health Commons schema/frontmatter conventions, keep the biomarker route data-driven, avoid widening the query change beyond the imported glucose projection seam, and treat the supplied patch as intent rather than overwrite authority.
- Product/process constraints: preserve unrelated dirty-tree edits, do not expose direct personal identifiers in repo files or commit metadata, and use the repo plan/ledger plus scoped commit workflow.

## Risks and mitigations

1. Risk: the supplied patch may not apply cleanly because related Health Commons generated artifacts and the monthly change ledger already have overlapping in-progress edits.
   Mitigation: dry-run with `git apply --check`, then port only the minimal conflicting hunks and stage only the task-owned slice.
2. Risk: regenerated Health Commons artifacts may pick up overlapping active biomarker churn that is not safely attributable to this task.
   Mitigation: inspect the generated diff carefully, compare against the supplied patch intent, and stop if current shared-file overlap cannot be scoped confidently.
3. Risk: repo verification may be partially blocked by unrelated pre-existing workspace issues in the dirty tree.
   Mitigation: prefer the truthful scoped verification lane, capture exact failing commands/targets, and confirm whether any failure is unrelated before handoff.

## Tasks

1. Register the task in the coordination ledger and inspect the supplied patch against current `HEAD`.
2. Apply or minimally port the blood glucose biomarker patch without widening scope.
3. Run the directly required generation/verification commands and inspect the resulting diff for overlap.
4. Run the mandatory completion audits for this standard repo change and address any findings.
5. Create a scoped commit with plan and ledger closeout.

## Decisions

- Use a dedicated active plan because this supplied patch spans multiple authored content files plus a query code change in a dirty tree.
- Keep the implementation scoped to `packages/health-commons/**` and `packages/query/src/browser-replica.ts` unless verification exposes a directly coupled requirement elsewhere.

## Verification

- Commands to run:
- `git apply --check <supplied-patch>`
- `git apply <supplied-patch>` or equivalent minimal manual port
- `pnpm typecheck`
- `bash scripts/workspace-verify.sh test:diff packages/health-commons/content/biomarkers/blood-glucose.md packages/health-commons/content/sources/blood-glucose packages/health-commons/content/changes/2026-04.jsonl packages/health-commons/generated/catalog.hash packages/health-commons/generated/catalog.json packages/health-commons/generated/entities.ndjson packages/health-commons/generated/recent-changes.json packages/query/src/browser-replica.ts`
- `pnpm --dir packages/health-commons verify`
- `pnpm test:smoke`
- `git diff --check`
- Expected outcomes:
- The supplied patch lands cleanly or is minimally ported with equivalent behavior/content.
- The affected Health Commons content and generated artifacts are current and scoped.
- The query/browser projection change passes the truthful verification lane.
- Any remaining failed check, if present, is attributable to a precise unrelated blocker rather than this diff.
Completed: 2026-04-23
