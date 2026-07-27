# PR 1015 warm-function drain gate

Status: active
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
- Pause only the two existing group-sharing mutation owners.
- Return an explicit retryable 503 before mutation; do not acknowledge or
  silently drop work.
- Delete the temporary gate after the first revision-aware bundle has been the
  sole production writer for the full drain interval.

## Approach

1. Add one temporary environment-controlled assertion shared by group-offer
   acceptance and explicit group-email revocation.
2. Prove both owners return the same retryable maintenance error before
   touching their transaction client.
3. Document a two-deployment rollout: first promote the current bundle with the
   gate enabled, wait the existing 600-second maximum prior-function drain, then
   redeploy the same head with the gate disabled.
4. Keep the gate enabled through migration, build, promotion, and exact-head
   smoke. A failed first deployment leaves the old bundle active; a failed
   second deployment leaves the current bundle safely paused.
5. Run focused tests, canonical diff verification, acceptance, parent review,
   exact-head ReviewGPT correction round 4, and CI.

## Deployment

- This PR must not use an ordinary one-step production promotion.
- The first production deployment sets
  `HOSTED_GROUP_SHARING_AUTHORITY_MAINTENANCE=1`.
- After that gated deployment is the production alias, wait 600 seconds and
  verify the old bundle has no live affected invocation.
- Redeploy the same reviewed head without the flag, verify the alias and one
  current-bundle reaction/permission smoke, then remove the temporary module,
  env configuration, and runbook text in a later cleanup PR.
