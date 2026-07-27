# PR 1015 warm-function drain gate

Status: completed
Created: 2026-07-27
Updated: 2026-07-27

## Goal

- Prevent an older warm hosted-Web function from applying a group reaction or
  permission decision during the one-time sharing-revision rollout.
- Preserve retryability and avoid a persistent compatibility owner.

## Proven cause

- The revision-based authority fence is complete once every request runs the
  current bundle.
- Vercel can keep a prior production function invocation alive after the new
  bundle is promoted.
- A prior-bundle reaction can resume after a current-bundle denial, or a
  prior-bundle no-op denial can commit without advancing the new revision.

## Constraints

- Add no table, queue, repair pass, dual-write protocol, or compatibility
  state.
- Pause only matched join-reaction receipt admission and the four existing
  group-sharing mutation entry points.
- Return an explicit retryable 503 before mutation; do not acknowledge or
  silently drop work.
- Delete the temporary gate after the first revision-aware bundle has been the
  sole production writer for the full drain interval.

## Approach

1. Add one temporary environment-controlled assertion shared by matched Linq
   reaction admission, group-offer acceptance, authenticated join-page
   permission saves, membership leave, and explicit group-email revocation.
2. Prove matched reaction admission throws inside provider-event persistence
   so its receipt rolls back, and prove all four mutation entry points return
   the same retryable maintenance error before mutation.
3. Document a two-deployment rollout: first promote the current bundle with the
   gate enabled, wait the existing 600-second maximum prior-function drain, then
   redeploy the same head with the gate disabled.
4. Keep the gate enabled through migration, build, promotion, and exact-head
   smoke. A failed first deployment leaves the old bundle active; a failed
   second deployment leaves the current bundle safely paused. During migration
   and build the old bundle remains the only production writer; after promotion
   the gate prevents a current receipt or decision from overlapping any
   surviving old invocation.
5. Run focused tests, canonical diff verification, acceptance, parent review,
   exact-head ReviewGPT correction round 4, and CI.

## Evidence

- Final ReviewGPT round 3 on exact head
  `8dad9fe621291e19bd89f6af7237248b95275d60` found the rollout-only gap:
  a warm prior-bundle reaction or permission writer could commit without the
  current decision revision.
- The temporary flag now rejects all four membership/sharing mutation entry
  points before database access. Matched Linq reaction admission throws inside
  the provider-event transaction, so a current `pending:v2` receipt cannot
  commit while an old writer drains.
- The group-store and reaction suites pass all 95 tests. Hosted Web typecheck,
  scoped lint, and documentation drift checks pass.
- Canonical local `pnpm test:diff` passed every selected path and the complete
  affected Web verification, including the production build.
- Full local `pnpm verify:acceptance` passed on rerun: all 539 Web test files
  (6,886 tests), package coverage, the Web build, 1,989 Cloudflare Node tests,
  and both Cloudflare Workers tests. The first wrapper exited in the Web lane
  while its owned Web verification child still held the shared slot; the child
  was left untouched, and the clean rerun passed after it drained.

## Deployment

- This PR must not use an ordinary one-step production promotion.
- The first production deployment sets
  `HOSTED_GROUP_SHARING_AUTHORITY_MAINTENANCE=1`.
- After that gated deployment is the production alias, wait 600 seconds and
  verify the old bundle has no live affected invocation.
- Redeploy the same reviewed head without the flag, verify the alias and one
  current-bundle reaction/permission smoke, then remove the temporary module,
  env configuration, and runbook text in a later cleanup PR.
Completed: 2026-07-27
