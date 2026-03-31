# Fix Cloudflare deploy preflight dependency ordering

Status: completed
Created: 2026-04-01
Updated: 2026-04-01

## Goal

- Restore the manual Cloudflare hosted deploy workflow so a freshly dispatched GitHub Actions runner can execute the `deploy:preflight` check instead of failing before dependency installation.

## Success criteria

- `.github/workflows/deploy-cloudflare-hosted.yml` installs workspace dependencies before any `pnpm exec tsx ...` deploy helper step runs.
- Required repo verification for the workflow/config change passes.
- Focused proof shows `apps/cloudflare deploy:preflight` now reaches the validation script rather than failing with `tsx` resolution errors.

## Scope

- In scope:
- Narrow fix to the hosted Cloudflare deploy workflow ordering, plus the required plan/ledger bookkeeping.
- Out of scope:
- Broader deploy workflow redesign, Cloudflare config changes, or changes to deploy helper script behavior beyond what is needed to restore the broken run path.

## Constraints

- Technical constraints:
- Preserve the existing deploy semantics and secret handling; only repair the runner bootstrap ordering.
- Product/process constraints:
- Treat this as a high-risk deploy-surface change: keep the diff narrow, run the required repo checks, perform the required completion review, and use the scoped commit helper.

## Risks and mitigations

1. Risk: Reordering steps could mask an intended "fail before install" behavior.
   Mitigation: Keep `deploy:preflight` unchanged and only move it after `pnpm install`, which is already required by later workflow steps that use the same `pnpm exec tsx` toolchain.

## Tasks

1. Register the active work in the coordination ledger and document the execution plan.
2. Patch the workflow so dependency installation precedes the `deploy:preflight` step.
3. Run repo-required verification plus focused proof for the repaired preflight path.
4. Run the required completion review, address findings if any, and create the scoped commit.

## Decisions

- Keep the fix in the workflow ordering rather than changing deploy helper scripts, because the workflow is the broken layer: a clean GitHub runner has no installed `tsx` binary until `pnpm install` completes.

## Verification

- Commands to run:
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
- Focused proof: `pnpm --dir apps/cloudflare deploy:preflight` in the local workspace
- Expected outcomes:
- Repo-required verification passes.
- The focused proof fails only on missing deploy env when run locally, not on `tsx` or missing `node_modules`.

## Outcome snapshot

- Workflow patched so `pnpm install --frozen-lockfile` now runs before the `deploy:preflight` step.
- Verification completed:
  - `pnpm typecheck` passed.
  - `pnpm test` passed.
  - `pnpm test:coverage` passed.
  - Focused proof reached `apps/cloudflare/scripts/validate-deploy-env.ts` and failed on missing `CF_WORKER_NAME`, `CF_BUNDLES_BUCKET`, and `CF_BUNDLES_PREVIEW_BUCKET`, confirming the prior `tsx not found` bootstrap failure is gone.
- Required final review pass completed with no findings.
- Task closed and scoped commit created.
Completed: 2026-04-01
