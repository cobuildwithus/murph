# Murph Age Source Route Registry

## Goal

Add a metadata-only Murph Age source-route registry that records the current source strategy for the layered model path: R399/NHIS as the frozen research anchor, lab/body cohorts as biomarker-increment routes, wearable/activity cohorts as shadow-increment routes, transport-stress cohorts, and partner aggregate validation.

## Scope

- `packages/health-metrics/src/murph-age-source-routes.ts`
- `packages/health-metrics/src/index.ts`
- `packages/health-metrics/test/index.test.ts`

## Constraints

- No row values, participant identifiers, split membership, coefficients, predictions, source bodies, codebook text, local filesystem paths, URLs, credentials, account facts, or private download state.
- The registry is source-strategy metadata only. It must not authorize product display, user-facing validation claims, recommendations, protocol claims, or score-bearing wearable/lab increments.
- Keep ReviewGPT for major science/architecture decisions; this task is local scaffold plumbing from already-reduced strategy.
- Preserve unrelated hosted-runner/final-fixes worktree edits.

## Verification Plan

- `pnpm --dir packages/health-metrics test -- index`
- `pnpm --dir packages/health-metrics typecheck`
- `pnpm --dir packages/health-metrics test:coverage`
- `pnpm test:diff packages/health-metrics/src/murph-age-source-routes.ts packages/health-metrics/src/index.ts packages/health-metrics/test/index.test.ts`
- `pnpm test:smoke`
- `pnpm logs:guard`
- `git diff --check -- packages/health-metrics/src/murph-age-source-routes.ts packages/health-metrics/src/index.ts packages/health-metrics/test/index.test.ts agent-docs/exec-plans/active/2026-05-12-murph-age-source-route-registry.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md`

## State

- Done: added the typed metadata-only source-route registry, exported it from `@murphai/health-metrics`, and covered route ordering, resolution, priority filtering, clone safety, metadata-only boundaries, product-use blocking, and prohibited text validation.
- Verification passed: `pnpm --dir packages/health-metrics test -- index`; `pnpm --dir packages/health-metrics typecheck`; `pnpm --dir packages/health-metrics test:coverage`; `pnpm test:smoke`; `pnpm logs:guard`; scoped `git diff --check`.
- Audit passed: security/privacy review finding patched with prohibited text validation; simplify review had no findings; coverage-write expanded validator branch coverage; final review had no blocking findings.
- Known unrelated blocker: `pnpm test:diff packages/health-metrics/src/murph-age-source-routes.ts packages/health-metrics/src/index.ts packages/health-metrics/test/index.test.ts` still fails in `packages/assistant-runtime` hosted-runtime liveness tests before reaching health-metrics dependent checks.
- Next: close the plan with `scripts/finish-task`.
Status: completed
Updated: 2026-05-12
Completed: 2026-05-12
