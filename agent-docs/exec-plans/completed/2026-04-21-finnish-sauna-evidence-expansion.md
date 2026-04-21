# Finnish sauna evidence expansion

Status: completed
Created: 2026-04-21
Updated: 2026-04-21

## Goal

- Land the supplied Finnish sauna evidence-expansion patch for the Health Commons sauna corpus without widening into unrelated UI or non-sauna content work.

## Success criteria

- The Finnish sauna source/content slice from the supplied patch is represented cleanly on top of current `HEAD`.
- Directly coupled generated Health Commons artifacts are regenerated from the landed content state.
- Any directly coupled hosted-web expectation or projection change required by the landed data is updated without widening scope.
- Truthful verification for the touched Health Commons and directly coupled hosted-web slice passes, or any unrelated blocker is named precisely.
- A scoped commit includes only this task's files plus plan/ledger closeout.

## Scope

- `packages/health-commons/content/{changes/2026-04.jsonl,protocols/dry-sauna/murph-finnish-standard-3x-week.md,sources/sauna/**}`
- `packages/health-commons/generated/**`
- `apps/web/src/lib/health-commons/experiment-detail.ts` only if the current app projection still needs a directly coupled sauna-evidence adjustment
- directly coupled `apps/web/test/{browser-vault-dashboard-pages,health-commons-experiment-detail-page}.test.ts*` only if required

## Constraints

- Treat the supplied patch as behavioral intent, not overwrite authority; merge onto current `HEAD` if stale hunks no longer apply verbatim.
- Preserve unrelated worktree state and avoid widening into other active Health Commons or experiment-detail rows.
- Keep the landing data-first; do not introduce new UI behavior unless a directly coupled expectation fix is required by current code.
- Avoid exposing direct personal identifiers in docs, generated files, commits, or handoff.

## Tasks

1. [x] Create the plan/ledger linkage for this task.
2. [x] Dry-run and apply the supplied patch, repairing stale hunks only where needed.
3. [x] Regenerate directly coupled Health Commons generated artifacts.
4. [x] Run truthful verification for the touched slice and capture direct evidence.
5. [x] Run a final local review of the landed diff and verification evidence.
6. [ ] Close the plan and create a scoped commit.

## Verification

- `git apply --check -p1 /Users/willhay/Downloads/finnish-sauna-evidence.patch`
  failed only on stale `packages/health-commons/generated/{catalog.hash,catalog.json,entities.ndjson}` hunks.
- `git apply --check -p1 /tmp/finnish-sauna-evidence.content-only.patch`
  passed after stripping the stale generated hunks and the malformed footer hunks that would have collapsed frontmatter closers onto body text.
- `pnpm --dir packages/health-commons generate`
  passed.
- `pnpm --dir packages/health-commons typecheck`
  passed.
- `pnpm --dir packages/health-commons test:coverage`
  passed.
- `pnpm --dir packages/health-commons generate:check`
  passed.
- `pnpm test:smoke`
  passed.
- `pnpm typecheck`
  failed for an unrelated pre-existing hosted-execution test typing issue:
  `packages/hosted-execution/test/hosted-execution.test.ts(216,9): error TS2741: Property 'localManifestHash' is missing in type '{ sessionId: string; }' but required in type 'HostedExecutionVaultSyncImportReference'.`
- `git diff --check`
  passed.

## Direct evidence

- Regenerated `entities.ndjson` now reports `81` Finnish dry-sauna yes/likely source rows and all `81` carry `researchEvidence`.
- `63` rows now carry numeric participant counts and `18` do not.
- The no-numeric subset consists of `17` narrative reviews plus `1` older pregnancy survey without a reliable exposed `n`.
- Deduping `aggregateRole: primary` rows by `cohortKey` and taking the max reported cohort size per cohort yields `43` primary cohorts/studies and `7,905` coded participants.

## Notes

- The coordination ledger already had an active row for this exact supplied patch; this plan filled the missing execution artifact for that row.
- The supplied patch carried malformed footer hunks for every touched source file and the bibliography page. Those hunks were intentionally not applied; only the `researchEvidence` additions were landed, then the generated outputs were rebuilt from repo state.
- Unrelated worktree edits outside this task remain present in `apps/web`, `packages/assistant-runtime`, `packages/core`, and `packages/hosted-execution`. They must stay out of the scoped commit.
Completed: 2026-04-21
