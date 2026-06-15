# PR 176 PlasticList CI Follow-Up

## Goal

Fix the release app verification failure on PR 176 without broadening the
contaminant import architecture.

Success criteria:

- The PlasticList import script handles the CI fixture path consistently across
  local macOS and Ubuntu runners.
- The focused product-test schema coverage passes.
- The normal completion workflow closes this plan and leaves no stale ledger
  row.

## Context

ReviewGPT round 22 reported no remaining medium-or-higher findings. The current
blocker is separate: Ubuntu release app verification fails in
`apps/web/test/product-tests-schema.test.ts` while running
`apps/web/sql/product-tests/import-plasticlist.sh` with:

```text
Missing required PlasticList column: plasticlist_sample_id
```

## Constraints

- Keep the fix narrow to the PlasticList import/test path unless evidence proves
  a broader issue.
- Do not change the product contaminant data model or fuzzy-linking policy.
- Preserve all source-backed rows as exact source-linked data.
- Do not expose local filesystem paths or personal identifiers in committed
  artifacts.

## Plan

1. Inspect the import shell/AWK path and the failing schema test fixture. Done.
2. Reproduce the failure or identify the macOS/Ubuntu parser difference from
   code evidence. Done: the script stripped BOM bytes with a byte-oriented
   `sprintf("%c%c%c",239,187,191)` pattern, while GNU awk in a UTF-8 locale can
   interpret `%c` as characters instead of the raw bytes in CI.
3. Apply the smallest durable fix. Done: run the PlasticList AWK preprocessor
   under `LC_ALL=C` and keep the existing BOM/CRLF transform coverage.
4. Run focused verification, then the required completion checks. Done.
5. Close the plan with `scripts/finish-task`.

## Verification

- `bash -n apps/web/sql/product-tests/import-plasticlist.sh`: passed.
- `CI=1 pnpm --dir apps/web test:prepared -- apps/web/test/product-tests-schema.test.ts`:
  passed, 2,437 tests passed and 6 skipped.
- `pnpm --dir apps/web typecheck`: passed.
- `pnpm docs:drift`: passed.
- `git diff --check`: passed.
- `pnpm test:diff`: passed through `apps/web verify`; emitted the known unused
  `getPrisma` lint warning and known Turbopack NFT trace warning.
- `coverage-write` worker: tightened the test assertion to bind `LC_ALL=C`
  directly to the PlasticList AWK preprocessing invocation, then reran the
  focused prepared app test and `pnpm test:diff`; both passed.
Status: completed
Updated: 2026-06-15
Completed: 2026-06-15
