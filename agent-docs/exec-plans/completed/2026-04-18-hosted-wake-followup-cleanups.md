## Goal

Land the returned HostedWake follow-up cleanup patch on top of the current hard-cut tree without widening scope beyond the artifact's intended fixes.

## Scope

- `apps/cloudflare/src/user-runner/**`
- `apps/web/src/lib/hosted-wake/control.ts`
- `apps/web/src/lib/device-sync/wake-service.ts`
- `apps/web/src/lib/hosted-onboarding/webhook-{receipt-store,transport}.ts`
- focused hosted-web and hosted-runner tests required by the patch

## Constraints

- Preserve the current HostedWake hard-cut direction and avoid reintroducing legacy outbox or pending-dispatch behavior.
- Keep the change scoped to follow-up bug fixes, stale cleanup, and directly related coverage.
- Preserve any already-landed renamed dispatch-payload surfaces and current test organization where files have moved since the patch was generated.

## Verification

- Repo-required typecheck plus truthful scoped coverage-bearing verification for the touched `apps/web` and `apps/cloudflare` surfaces
- Required completion-workflow audit passes for a standard repo change
Status: completed
Updated: 2026-04-18
Completed: 2026-04-18
