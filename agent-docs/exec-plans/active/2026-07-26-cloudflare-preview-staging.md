# Reusable Cloudflare Preview Staging Lane

Status: active
Created: 2026-07-26
Updated: 2026-07-26

## Goal

- Add one reusable manual `preview` deployment lane for the existing hosted
  Cloudflare runtime without adding another deploy system or changing the
  production lane.
- Make the lane safe enough to host the R2 ENAM migration rehearsal and future
  staging-only runtime checks against isolated Web, crypto, and R2 resources.

## Success criteria

- The protected-main Cloudflare deploy workflow exposes `preview` alongside
  `production` and continues to use the selected GitHub Environment as the only
  configuration owner.
- Preview deploy preflight fails before Cloudflare mutation when crypto or
  Vercel OIDC context is not `preview`, a Worker/R2 resource is not visibly
  staging-scoped, or the preview Web origin aliases the declared production
  origin.
- Production defaults, protected-main checks, required secrets, container
  rollout rule, and deploy command remain unchanged.
- Focused deploy tests, diff-aware verification, acceptance, preliminary
  specialist review, final ReviewGPT, and CI all pass.
- External staging bootstrap creates or configures only isolated preview
  resources. If the required isolated Web/data/crypto inputs are unavailable,
  no Worker is deployed and the exact remaining prerequisite is documented.

## Scope

- In scope:
  - `.github/workflows/deploy-cloudflare-hosted.yml`
  - Cloudflare deploy preflight and focused tests
  - current Cloudflare deploy and verification documentation
  - the existing GitHub `Preview` Environment and provider-native preview
    resources, once their isolation prerequisites are proven
- Out of scope:
  - a second deployment framework, Vercel project, scheduler, or config owner
  - production Worker, bucket, database, crypto, or secret mutation
  - weakening runtime/auth/env invariants so a partial preview stack can boot
  - automatically deploying every pull request

## Constraints

- Technical constraints:
  - generated deploy config remains authoritative; checked-in
    `wrangler.jsonc` stays a local scaffold
  - the same Worker code must serve both environments through environment-owned
    values
  - preview must use an isolated Web/data/crypto trust boundary before any
    stateful rehearsal
- Product/process constraints:
  - smallest maintainable change; prefer validation and documentation over new
    state or abstractions
  - all deploys remain manual and protected-main-only
  - never read, copy, or expose production secret values

## Risks and mitigations

1. Risk: a preview dispatch accidentally targets a production Worker, bucket,
   Web origin, crypto environment, or Vercel token audience.
   Mitigation: bind deploy context to environment-specific invariants and reject
   unscoped preview resource names before render, secret sync, or deploy.
2. Risk: staging configuration drifts into a second deploy implementation.
   Mitigation: add one workflow choice and keep the existing generated
   config/preflight/deploy path as the sole owner.
3. Risk: an incomplete Vercel Preview environment reaches production data.
   Mitigation: require an isolated preview Web/data/crypto boundary; stop before
   Worker deployment when those prerequisites cannot be proven.

## Tasks

1. Add the protected-main `preview` workflow choice without changing production
   defaults.
2. Add narrow preview-isolation validation and regression tests.
3. Update current deploy and verification docs with the staging contract and
   bootstrap order.
4. Run focused verification, preliminary specialists, parent review,
   acceptance, final ReviewGPT, and CI.
5. Bootstrap the GitHub/Vercel/Cloudflare preview resources only after the
   isolated Web/data/crypto prerequisites are complete; otherwise leave all
   production resources untouched and record the blocker.

## Decisions

- Use the built-in Vercel `preview` target and existing GitHub `Preview`
  Environment rather than create another Vercel project or custom environment.
- Keep Cloudflare environment selection in the existing generated config path
  rather than add named Wrangler environments, which would duplicate every
  non-inheritable binding.
- Accept `preview` or `staging` as the visible resource-name marker for the
  preview lane so the existing staging naming convention remains valid.

## Verification

- Commands to run:
  - focused deploy preflight and deploy-automation tests
  - `pnpm test:diff ...`
  - `pnpm verify:acceptance`
  - preliminary `completion-specialists` ReviewGPT and final ReviewGPT gate
  - required PR CI
- Expected outcomes:
  - preview misconfiguration is rejected before any provider mutation
  - production deploy behavior and defaults remain covered and unchanged
