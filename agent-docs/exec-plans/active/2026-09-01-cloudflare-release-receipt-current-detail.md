# Cloudflare release receipt current-detail proof

Status: active
Created: 2026-09-01
Updated: 2026-09-01

## Goal

- Make the protected Cloudflare deploy receipt identify the exact container release started by the current Wrangler deploy, while certification independently proves that release became final.

## Success criteria

- Exact-name application discovery resolves each provider application through its authoritative detail endpoint before the receipt records version or image identity.
- A Wrangler `modified` action accepts only a new active rollout whose authoritative current state matches the pre-deploy application and records that rollout's target version and image.
- Focused tests reproduce stale application detail during an active rollout and prove the receipt records the exact target without mistaking a pre-existing rollout for the current deploy.
- The protected production workflow reports deploy success, smoke success, and release convergence for one exact Worker and all three exact container applications.

## Scope

- In scope: the public Cloudflare deploy receipt reader, its focused tests, and the deploy contract documentation.
- Out of scope: runtime wake ownership, container rollout policy, provider capacity, or a second deployment owner.

## Root-cause evidence

- Two consecutive protected deploys recorded receipts whose three container versions were each exactly one snapshot behind the final provider detail state, and whose image digests all differed from that final state.
- The Worker version and tag matched exactly, all three final container rollouts completed, and no other protected deploy workflow overlapped.
- The receipt writer currently records version and image from the container application list response, while certification resolves the same application through the detail endpoint.
- After the detail-source correction, Wrangler reported all three applications modified and moved the Worker to the exact new version, while the immediate post-deploy detail reads still returned every pre-deploy container version. The one-shot receipt classification therefore rejected a real asynchronous provider transition before smoke or certification could start.
- A bounded two-minute retry still failed after all three Wrangler updates succeeded. Cloudflare's application summary showed the large runner rollout was not terminal, matching Cloudflare's documented contract that deploy success means a rollout started and that the effective application can remain on the preceding image while instances are replaced.
- Cloudflare's rollout resource already owns the exact `current_version`, `current_configuration`, `target_version`, and `target_configuration` required to identify the release before convergence. The private certifier already polls until application detail matches that target and the rollout is complete.

## Plan

1. Resolve list-discovered application identifiers through exact application detail reads before parsing receipt identity.
2. Resolve a newly active rollout after Wrangler succeeds and derive the immutable receipt from its authoritative target while application detail is still current-state stale.
3. Add focused stale-list/current-detail, active-target, reused-rollout, malformed-detail, redaction, and unchanged-transition regressions.
4. Run focused Cloudflare tests, app typecheck, complexity, diff/privacy review, exact-head CI, merge, and protected deployment.
5. Verify exact release convergence and then recheck the independent residual runtime backlog.

## Deployment concerns

- The public receipt producer must merge before the next protected private deployment consumes it.
- Old private verification remains compatible with the schema-1 receipt; only the evidence source changes.
- An active rollout that is unreadable, reused from before this deploy, or does not join the pre-deploy current state to one exact target stops before publishing a receipt. A successful receipt continues to require exact Worker traffic, container version, image, capacity, and terminal rollout proof.

## Verification

- Passed: 65 focused Cloudflare receipt and deploy-helper tests, including active-rollout target evidence, delayed provider-detail convergence, and fail-closed exhaustion.
- Passed: `apps/cloudflare` package typecheck.
- Passed: cyclomatic-complexity diff; the changed receipt owner remains below the threshold with no new debt.
- Passed: `git diff --check` and parent inspection of the complete source, test, documentation, and plan diff.
- Pending: exact-head required GitHub Actions, merge, protected production deployment, exact release certification, and independent runtime-backlog recovery proof.
