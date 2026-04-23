## Title

Make hosted-local cross-app startup depend on a lightweight hosted web health route instead of the homepage.

## Goal

Unblock the hosted local cross-app proof by giving `apps/web` a stable low-dependency health endpoint and teaching the hosted local stack to probe that endpoint during startup instead of `GET /`.

## Scope

- `apps/web/app/api/internal/health/route.ts`
- `scripts/dev-hosted-local/{stack,stack.test}.ts`
- focused proof tests in `apps/web` and/or `apps/cloudflare` only if needed for the new health surface
- minimal docs only if the runtime contract needs explicit recording

## Constraints

- Keep the new endpoint lightweight and free of homepage/onboarding dependency chains.
- Do not weaken existing auth or hosted execution invariants.
- Avoid broad local-dev harness refactors; this is a reliability cleanup for startup readiness only.
- Preserve the current worker `/health` readiness behavior.

## Verification

- `pnpm typecheck`
- `bash scripts/workspace-verify.sh test:diff apps/web/app/api/internal/health/route.ts scripts/dev-hosted-local/stack.ts scripts/dev-hosted-local/stack.test.ts`
- full hosted local cross-app proof after the targeted checks are green

## Notes

- The explicit problem is startup brittleness: local hosted E2E should not fail just because the homepage imports a dependency that the execution path does not need.
- The route should be explicit enough that future hosted-local startup failures point at web-process health rather than unrelated landing-page rendering.
Status: completed
Updated: 2026-04-24
Completed: 2026-04-24
