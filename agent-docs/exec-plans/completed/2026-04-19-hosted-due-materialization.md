## Goal

Materialize runnable hosted due work into the web-owned `HostedWake` queue before Cloudflare alarm nudges drain it, so assistant cron and due device-sync reconcile no longer depend on unrelated future traffic.

## Scope

- `packages/assistant-runtime/src/hosted-runtime/**`
- `packages/hosted-execution/**`
- `apps/cloudflare/src/{user-runner.ts,web-control-plane.ts,user-runner/**}`
- `apps/web/src/lib/{hosted-wake,device-sync}/**`
- `apps/web/app/api/internal/hosted-wake/**`
- focused tests under `apps/cloudflare/test/**` and `apps/web/test/**`

## Constraints

- Treat this as greenfield hosted execution; prefer direct-cut contracts over compatibility scaffolding.
- Materialize only runnable-now work. Do not enqueue far-future rows into the canonical queue.
- Keep Cloudflare as an alarm/lease/execution shim. Queue correctness stays web-owned.
- Cover assistant cron and due device-sync reconcile in this patch. Do not invent parser wake ownership unless a current hosted parser dependency requires it.
- Preserve unrelated in-flight hosted web, onboarding, and runtime edits.

## Verification

- `pnpm typecheck`
- truthful focused coverage via `pnpm test:diff` or the touched owner coverage lanes if diff coverage is not sufficient
- direct proof in focused tests that alarm-triggered materialization appends runnable wakes before drain
Status: completed
Updated: 2026-04-19
Completed: 2026-04-19
