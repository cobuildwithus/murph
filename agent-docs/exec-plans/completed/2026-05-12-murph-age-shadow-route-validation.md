# Murph Age Shadow Route Validation

## Goal

Wire wearable shadow result-card validation to the Murph Age source-route registry so aggregate shadow evidence can only cite known wearable-shadow source routes and cannot drift into arbitrary route ids.

## Scope

- `packages/health-metrics/src/murph-age.ts`
- `packages/health-metrics/test/index.test.ts`

## Constraints

- Do not change model science, route priority, product authorization, or dataset access policy.
- Keep this as local guardrail plumbing; ReviewGPT is reserved for major source/model strategy decisions.
- Preserve unrelated hosted-runner/final-fixes worktree edits.

## Verification Plan

- `pnpm --dir packages/health-metrics test -- index`
- `pnpm --dir packages/health-metrics typecheck`
- `pnpm --dir packages/health-metrics test:coverage`
- `pnpm test:smoke`
- `pnpm logs:guard`
- `git diff --check -- packages/health-metrics/src/murph-age.ts packages/health-metrics/test/index.test.ts agent-docs/exec-plans/active/2026-05-12-murph-age-shadow-route-validation.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md`

## State

- Done: wired wearable shadow result-card `sourceRouteId` validation to the source-route registry and covered valid, unknown, and non-wearable registered routes.
- Verification passed: `pnpm --dir packages/health-metrics test -- index`; `pnpm --dir packages/health-metrics typecheck`; `pnpm --dir packages/health-metrics test:coverage`; `pnpm test:smoke`; `pnpm logs:guard`; scoped `git diff --check`.
- Audit passed: security/privacy review found no issues; coverage-write found no missing proof; final review found no blocking issues.
- Next: close with `scripts/finish-task`.
Status: completed
Updated: 2026-05-12
Completed: 2026-05-12
