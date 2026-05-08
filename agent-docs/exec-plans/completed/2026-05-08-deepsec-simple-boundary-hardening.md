# DeepSec Simple Boundary Hardening

## Goal

Close the low-complexity remaining DeepSec boundary findings without adding broad abstractions:

- Redact non-Bearer `Authorization` credentials.
- Redact split secret argv values in hosted-local harness state.
- Reject malformed deploy integer environment values instead of truncating.
- Reject inherited-property assistant channel lookups.
- Avoid echoing sensitive source URLs in Health Commons validation errors.
- Require HTTPS for configured public webhook base URLs.

## Constraints

- Keep fixes local to existing helper boundaries.
- Do not add dependencies or new shared abstractions.
- Preserve unrelated dirty worktree edits and active plan rows.
- Do not expose secrets, local paths, or personal identifiers in docs/tests/output.

## Plan

1. Inspect each target helper and existing focused tests.
2. Implement minimal validation/redaction changes in place.
3. Add focused regression tests at the owning package boundaries.
4. Run package-local typecheck/coverage where available plus scoped diff checks.
5. Run required security/privacy, coverage, and final review passes.
6. Close the plan with a scoped commit if the worktree allows it.

## Verification

- `git diff --check` passes.
- `pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts --no-coverage test/redaction.test.ts test/assistant-channels-runtime.test.ts` passes.
- `pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts --no-coverage test/redaction.test.ts test/assistant-runtime-events.test.ts test/outbox-dispatch-state.test.ts test/turn-receipt-redaction.test.ts test/assistant-automation-support.test.ts test/assistant-product-small-seams.test.ts test/provider-registry-helpers.test.ts` passes.
- `pnpm --dir packages/assistant-engine test:coverage` passes.
- `pnpm exec vitest run --config scripts/vitest.config.ts --no-coverage scripts/hosted-local.test.ts` passes.
- `pnpm --dir apps/cloudflare exec vitest run --config vitest.node.workspace.ts --no-coverage test/deploy-automation.test.ts -t "rejects partial numeric deploy automation values"` passes.
- `pnpm --dir packages/health-commons exec vitest run --config vitest.config.ts --no-coverage test/catalog-coverage.test.ts` passes.
- `pnpm --dir packages/setup-cli exec vitest run --config vitest.config.ts --no-coverage test/setup-wizard.test.ts` passes.
- `pnpm --dir packages/setup-cli test:coverage` passes.
- Typecheck passes for `packages/assistant-engine`, `packages/setup-cli`, `packages/health-commons`, `packages/hosted-local-harness`, and `apps/cloudflare`.
- Blocked unrelated: full `apps/cloudflare` deploy automation test file currently fails because pending Cloudflare container work expects a second deploy smoke container while existing expectations still require one container.
- Blocked unrelated: `pnpm --dir packages/health-commons test:coverage` currently fails on the generated biomarker browse index expecting `sleep-quality`, and the partial run does not meet global coverage thresholds.

## Handoff Notes

- Keep the commit scoped to the six boundary hardening fixes and their focused tests.

Status: completed
Updated: 2026-05-08
Completed: 2026-05-08
