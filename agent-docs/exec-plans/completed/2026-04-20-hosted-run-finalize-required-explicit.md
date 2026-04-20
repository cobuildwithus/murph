## Title

Make hosted run commit finalize intent explicit and always true for prepared successful run drains.

## Goal

Remove the remaining optional/null `finalizeRequired` contract ambiguity for hosted run commits and make successful prepared run drains always commit with `finalizeRequired: true` so web-owned finalize always runs after a prepared snapshot commit.

## Scope

- `apps/cloudflare/src/user-runner.ts`
- `apps/cloudflare/src/user-runner/runner-run-processor.ts`
- focused Cloudflare tests covering prepared run-drain commit behavior
- `apps/web/src/lib/hosted-run/store.ts`
- `packages/hosted-execution/src/contracts.ts`
- `packages/hosted-execution/src/parsers/run-control.ts`
- directly coupled shared/web tests covering the hosted-run commit request contract

## Constraints

- Keep this as a narrow hosted-run finalize contract fix only.
- Preserve unrelated dirty-tree edits and overlapping Cloudflare/web hosted-run work.
- Prefer the greenfield rule: every successful prepared run drain must request explicit finalize.
- Do not broaden into finalize-reasons payloads in this pass.

## Verification

- passed: `pnpm --dir packages/hosted-execution test -- packages/hosted-execution/test/hosted-run-drain-parsers-coverage.test.ts packages/hosted-execution/test/hosted-wake-parsers.test.ts`
- passed: `pnpm --dir apps/cloudflare test:node -- apps/cloudflare/test/runner-run-processor.test.ts apps/cloudflare/test/user-runner-resume-finalize.test.ts`
- passed: `pnpm exec vitest run --config apps/web/vitest.workspace.ts --project hosted-web-store-config apps/web/test/hosted-run-store.test.ts --no-coverage`
- passed: `git diff --check`
- failed unrelated: `bash scripts/workspace-verify.sh test:diff apps/cloudflare/src/user-runner.ts apps/cloudflare/src/user-runner/runner-run-processor.ts apps/cloudflare/test/runner-run-processor.test.ts apps/cloudflare/test/user-runner-resume-finalize.test.ts apps/web/src/lib/hosted-run/store.ts apps/web/test/hosted-run-store.test.ts packages/hosted-execution/src/contracts.ts packages/hosted-execution/src/parsers/run-control.ts packages/hosted-execution/test/hosted-run-drain-parsers-coverage.test.ts packages/hosted-execution/test/hosted-wake-parsers.test.ts` in pre-existing `packages/assistant-runtime` wake-to-run naming drift
- failed unrelated: `pnpm verify:acceptance` in pre-existing `apps/cloudflare` typecheck drift (`test/crypto.test.ts`, `test/storage-path-rotation.test.ts`, and `test/workers/test-hosted-wake-control.ts` still reference renamed or removed hosted-wake symbols)

## Notes

- The shared hosted-run commit contract previously allowed `finalizeRequired` to be omitted or `null`, and the web store previously defaulted omitted values to `true`.
- Cloudflare's runner-run processor already treated successful prepared committed snapshots as requiring finalize; this task tightened the explicit contract around that existing behavior.
- The landed change leaves quarantine and already-finalized paths unchanged while making prepared-success commit requests unambiguous.
- The required review-only completion pass found one proof gap: direct web-store coverage for the `finalizeRequired: true` branch. That proof was added in `apps/web/test/hosted-run-store.test.ts` and re-run through the focused hosted-web store project.
