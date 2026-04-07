# Move Vercel↔Cloudflare auth out of the shared hosted seam

Status: completed
Created: 2026-04-07
Updated: 2026-04-07

## Goal

- Keep the shared `@murphai/hosted-execution` seam vendor-neutral by moving the Vercel-specific bearer-token acquisition and Cloudflare-side OIDC validation/verification into app-local auth adapters.

## Success criteria

- `packages/hosted-execution` no longer exports or depends on Vercel OIDC helpers or worker auth validation state.
- `apps/web` creates hosted-execution clients through an app-local bearer-token adapter.
- `apps/cloudflare` reads and verifies Vercel OIDC workload identity through an app-local auth adapter.
- Shared hosted-execution clients remain generic bearer-auth clients with no vendor-specific logic.
- Focused tests cover the web adapter, Cloudflare adapter/env wiring, and the narrowed shared seam.

## Scope

- In scope:
- Remove the Vercel OIDC module/export surface from `packages/hosted-execution`.
- Move Cloudflare OIDC env parsing and request verification into `apps/cloudflare`.
- Keep the existing web bearer-token provider local to `apps/web` and make its ownership explicit.
- Update affected tests and durable docs for the new ownership boundary.
- Out of scope:
- Changing the hosted dispatch/control route layout or replacing bearer auth with a different mechanism.
- Reworking unrelated hosted-execution client, queue, or callback behavior.

## Constraints

- Technical constraints:
- Preserve the current bearer-authenticated `apps/web -> apps/cloudflare` behavior and fail-closed validation semantics.
- Do not widen the shared client seam or introduce new dependencies.
- Product/process constraints:
- Preserve unrelated dirty hosted-worktree edits and stay narrow in overlapping hosted files.

## Risks and mitigations

1. Risk: Shared tests or callers could still import the removed package OIDC helpers.
   Mitigation: Update all in-repo imports in the same change and remove the package export so typecheck catches stragglers.
2. Risk: Cloudflare env parsing could drift from the current worker behavior during the move.
   Mitigation: Port the existing tests into app-local coverage and keep the env contract unchanged.
3. Risk: The web client path could accidentally stop memoizing or normalizing the bearer token.
   Mitigation: Preserve the existing app-local token provider behavior and keep targeted web tests on the adapter.

## Tasks

1. Register the coordination row and trace all shared-package OIDC imports/usages.
2. Remove Vercel-specific auth helpers from `packages/hosted-execution` while keeping generic bearer clients intact.
3. Add app-local auth adapters for `apps/web` and `apps/cloudflare`, then repoint their imports/tests.
4. Update architecture/package docs, run focused verification plus required repo checks, complete the required audit pass, and finish with a scoped commit.

## Decisions

- Keep bearer-token injection as the shared client seam; only token acquisition and token validation move app-local.
- Keep the existing env variable names for Vercel OIDC validation so deploy/runtime config does not change.
- Leave HMAC-based Cloudflare -> web callbacks in the shared seam; only the Vercel-specific web -> Cloudflare bearer path moves out.

## Verification

- Commands to run:
- `pnpm typecheck`
- `pnpm test:coverage`
- `pnpm --dir apps/web lint`
- Expected outcomes:
- Shared package, hosted web, and Cloudflare tests pass with the vendor-specific auth ownership moved out of the shared seam.
Completed: 2026-04-07
