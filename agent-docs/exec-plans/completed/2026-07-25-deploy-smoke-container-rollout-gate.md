# Deploy Smoke Container Rollout Gate

## Goal

Make the deployed-endpoint runner-bundle smoke converge during a normal Cloudflare
container rollout, and fail attributably inside the deploy job timeout when it does
not.

## Background

Production deploy run `30149505443` deployed the Worker successfully, then spent 46
minutes and 119 retries asserting that the managed container ran the new runner
bundle. Every attempt reported the previous deploy's bundle, and the job was
cancelled at its 60-minute timeout before the retry budget was reached.

Cloudflare documents the underlying model: worker code updates immediately while
containers roll out gradually, so a newly deployed Worker version legitimately
coexists with old-image container instances until the rollout completes
(`/containers/platform-details/rollouts/`).

Two defects made that window fatal instead of transient:

1. The smoke pins one Worker version for the whole run, and the smoke container's
   Durable Object name is derived from that version
   (`resolveDeployContainerSmokeObjectName`). Every retry therefore addressed one
   Durable Object, hence one container instance. Once that instance was provisioned
   from the pre-rollout image it stayed stale, and the smoke's own ~24s polling kept
   it below the 20-minute idle TTL that would otherwise have reaped it. Retrying
   could not reach a different instance.
2. The retry budget is an attempt count with no wall-clock bound. At 300 attempts and
   ~24s per attempt the budget is ~118 minutes against a 60-minute job timeout, so a
   real convergence failure can never exhaust its own budget. It always surfaces as
   an opaque cancelled job, and `Publish deployment summary` never runs.

## Scope

- `apps/cloudflare/scripts/smoke-hosted-deploy.shared.ts`
- `apps/cloudflare/src/worker/route-handlers/deploy-smoke.ts`
- `apps/cloudflare/test/smoke-hosted-deploy.test.ts`
- `apps/cloudflare/test/index.test.ts`
- `.github/workflows/deploy-cloudflare-hosted.yml`
- `apps/cloudflare/DEPLOY.md`

## Constraints

- Do not weaken the bundle-identity assertion. A converged smoke must still prove the
  deployed bundle actually boots and serves.
- Keep the production per-user runner container lifecycle unchanged; this is
  deploy-smoke-only.
- Keep the existing attempt ceiling so retry tests stay deterministic without
  injecting a clock.
- No new persisted state, manager, or lifecycle machinery.

## Plan

1. Thread the retry attempt into the smoke request so each attempt addresses a fresh
   smoke Durable Object, and therefore a fresh container-provisioning decision. Set
   the attempt search param before signing so it is covered by the callback
   signature.
2. Accept the attempt segment in `resolveDeployContainerSmokeObjectName` and append it
   to the object name, leaving the existing identity precedence intact.
3. Add a wall-clock deadline to the runner-container smoke retry policy. On expiry,
   throw a non-retryable error naming elapsed time, attempts, and the last failure.
4. Set the deadline in the deploy workflow below the job timeout and above
   Cloudflare's documented 15-minute forced-kill window.
5. Cover: attempt-scoped object naming, per-attempt URL variation, deadline expiry,
   and preserved convergence/assertion behavior.
6. Document the deadline knob in `DEPLOY.md`.

## Verification

- Focused `apps/cloudflare` smoke and worker-index tests.
- `pnpm test:diff` over the touched paths.
- Typecheck.
Status: completed
Updated: 2026-07-25
Completed: 2026-07-25
