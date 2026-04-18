## Goal

Verify the live hosted hard-cut implementation against the canonical hosted wake cutover guide v2 and land the smallest set of remaining code changes needed to match the guide as closely as the current greenfield hard-cut target requires.

## Scope

- `apps/web/src/lib/hosted-wake/**`
- `apps/web/src/lib/hosted-onboarding/**`
- `apps/web/src/lib/hosted-share/**`
- `apps/web/src/lib/device-sync/**`
- `apps/web/app/api/internal/hosted-wake/**`
- `apps/cloudflare/src/**`
- `packages/assistant-runtime/src/hosted-runtime/**`
- `packages/hosted-execution/src/**`
- focused `apps/web`, `apps/cloudflare`, `packages/assistant-runtime`, and `packages/hosted-execution` tests

## Constraints

- Match the canonical hosted wake cutover guide v2, with bias toward the hard-cut target rather than preserving transitional machinery.
- Preserve unrelated hosted auth/pricing/release work already in flight elsewhere in the worktree.
- Prefer deleting leftover ownership layers over widening compensating mechanisms.
- Keep Cloudflare as lease/execution only; keep queue/cursor truth in web.

## Verification

- Focused owner tests for any touched `apps/web`, `apps/cloudflare`, `packages/assistant-runtime`, and `packages/hosted-execution` surfaces
- Relevant package/app typechecks for touched owners
- Repo-required completion audits before handoff
Status: completed
Updated: 2026-04-19
Completed: 2026-04-19
