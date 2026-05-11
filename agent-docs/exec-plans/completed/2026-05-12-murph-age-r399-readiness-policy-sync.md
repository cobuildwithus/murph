# Murph Age R399 Readiness Policy Sync

## Goal

Update the R399 layering readiness runner so it reflects the committed `r399_nhis_proxy_10y_acm_research` calculator policy instead of reporting that no committed R399 card exists.

## Scope

- `scripts/murph-age/r399-layering-readiness.ts`
- `scripts/murph-age/r399-layering-readiness.test.ts`
- `scripts/murph-age/midus2-local-benchmark.ts` (narrow imported-helper typecheck fix)
- `package.json` / `pnpm-lock.yaml` (root dev dependency on the package public entrypoint used by the script)

## Constraints

- Do not commit model coefficients, model parameters, row values, predictions, source text, local paths, or product claims.
- Preserve the research-only/product-blocked posture. This sync should mark the committed research policy as present, not production-ready.
- Preserve unrelated hosted-runner/final-fixes worktree edits.

## Verification Plan

- `pnpm exec vitest run --config scripts/vitest.config.ts --no-coverage scripts/murph-age/r399-layering-readiness.test.ts`
- `pnpm typecheck` or scoped fallback if unrelated hosted-runtime typecheck remains red
- `pnpm deps:guard`
- `pnpm logs:guard`
- `git diff --check -- scripts/murph-age/r399-layering-readiness.ts scripts/murph-age/r399-layering-readiness.test.ts agent-docs/exec-plans/active/2026-05-12-murph-age-r399-readiness-policy-sync.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md`

## State

- Done: runner now recognizes the committed R399 research-only model-card policy while keeping the calculator scoring path blocked until an ignored local model-card artifact and explicit research mode are wired.
- Done: imported MIDUS parity helper now handles age-derived model features without reaching for `metricKey`.
- Done: focused vitest, scoped `test:diff`, direct aggregate CLI probe, logs guard, dependency guard, diff check, security/privacy audit, and final review passed after the final-review gate-status correction.
- Note: global root-change `test:diff` reaches an unrelated CLI package-shape freshness check; the scoped Murph Age repo-tools path passed.
- Next: close with `scripts/finish-task`.
Status: completed
Updated: 2026-05-12
Completed: 2026-05-12
