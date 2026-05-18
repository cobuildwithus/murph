# Murph Age Public Wearable Shadow Status

## Goal

Make the current public lab/activity/wearable autoresearch state durable in tracked health-metrics code so Murph Age can answer, with tests, what the model currently knows about ordinary 16-50 lab plus wearable inputs.

Success criteria:

- Public NHANES lab/activity aggregate runs are summarized as shadow-only evidence.
- Wearable inputs remain explicitly non-score-bearing and product-blocked.
- Architecture summary exposes the current evidence status and next data-source lane.
- Tests cover the aggregate metrics, product gates, and privacy boundary.

## Constraints

- No private rows, source text, variable names, local paths, predictions, coefficients, or product display.
- Prioritize ordinary submitter inputs: consumer wearable activity plus common bloodwork/labs.
- Preserve unrelated working-tree edits.
- Keep ReviewGPT for actual architecture/scientific interpretation gates, especially when external or partner aggregate deltas arrive.

## Files

- `packages/health-metrics/src/murph-age.ts`
- `packages/health-metrics/test/index.test.ts`

## Verification

- Passed: `pnpm --dir packages/health-metrics test`
- Passed: `pnpm --dir packages/health-metrics typecheck`
- Passed: `pnpm --dir packages/health-metrics test:coverage`
- Blocked by unrelated clean-file failure: `bash scripts/workspace-verify.sh test:diff packages/health-metrics/src/murph-age.ts packages/health-metrics/test/index.test.ts`
  - Failing target: `packages/health-commons/test/cli-coverage.test.ts`
  - Failure: dry-run expected a Cloudflare R2 upload command, but the generated candidate reports missing `byteSize` and `sha256`.
  - Current diff does not touch health-commons content, generator code, or R2 sync tests.
- Blocked by unrelated dirty hosted-web/browser-vault work: `pnpm typecheck`
  - Failing target: `apps/web/app/api/internal/hosted-workspace/browser-vault-replica/route.ts`
  - Failure: `expectedWorkspaceVersion` is passed to an API type that currently accepts `expectedSourceStateHash`.
  - Current diff is confined to health-metrics model metadata/tests and does not touch hosted-web/browser-vault files.
- Passed: `pnpm test:smoke`
- Passed: tracked diff whitespace check.
- Passed: scoped privacy scan over the tracked health-metrics diff and this plan.
- ReviewGPT R1108 source/endpoint science call sent to Extended Pro for the high-level All of Us/CARDIA/HCHS-SOL/UKB/NSRR decision; no product or score-bearing promotion while awaiting response.

## Audit Outcomes

- `security-privacy-review`: passed with no findings.
- `coverage-write`: found missing architecture-summary equality and per-packet gate assertions; both were fixed in tests.
- `task-finish-review`: found missing diff-aware/package coverage proof, missing recorded audit context, and commit scoping reminders; package coverage now passes, plan outcomes are recorded here, and scoped commit will use `scripts/finish-task`.
Status: completed
Updated: 2026-05-18
Completed: 2026-05-18
