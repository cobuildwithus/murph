# Cloudflare release receipt current-detail proof

Status: active
Created: 2026-09-01
Updated: 2026-09-01

## Goal

- Make the protected Cloudflare deploy receipt identify the exact container application state produced by the current Wrangler deploy, so certification cannot compare a delayed application-list snapshot with current application detail.

## Success criteria

- Exact-name application discovery resolves each provider application through its authoritative detail endpoint before the receipt records version or image identity.
- A Wrangler `modified` action waits through bounded provider-detail propagation and cannot publish a receipt while the post-deploy detail state is byte-for-byte unchanged from the pre-deploy detail state.
- Focused tests reproduce a stale list result paired with a current detail result and prove the receipt uses only the current detail.
- The protected production workflow reports deploy success, smoke success, and release convergence for one exact Worker and all three exact container applications.

## Scope

- In scope: the public Cloudflare deploy receipt reader, its focused tests, and the deploy contract documentation.
- Out of scope: runtime wake ownership, container rollout policy, provider capacity, or a second deployment owner.

## Root-cause evidence

- Two consecutive protected deploys recorded receipts whose three container versions were each exactly one snapshot behind the final provider detail state, and whose image digests all differed from that final state.
- The Worker version and tag matched exactly, all three final container rollouts completed, and no other protected deploy workflow overlapped.
- The receipt writer currently records version and image from the container application list response, while certification resolves the same application through the detail endpoint.
- After the detail-source correction, Wrangler reported all three applications modified and moved the Worker to the exact new version, while the immediate post-deploy detail reads still returned every pre-deploy container version. The one-shot receipt classification therefore rejected a real asynchronous provider transition before smoke or certification could start.

## Plan

1. Resolve list-discovered application identifiers through exact application detail reads before parsing receipt identity.
2. Poll the post-deploy detail snapshots for at most two minutes after Wrangler succeeds, and reject an unchanged state at the deadline.
3. Add focused stale-list/current-detail, delayed-transition, malformed-detail, redaction, and unchanged-transition regressions.
4. Run focused Cloudflare tests, app typecheck, complexity, diff/privacy review, exact-head CI, merge, and protected deployment.
5. Verify exact release convergence and then recheck the independent residual runtime backlog.

## Deployment concerns

- The public receipt producer must merge before the next protected private deployment consumes it.
- Old private verification remains compatible with the schema-1 receipt; only the evidence source changes.
- A detail state that remains unreadable or stale through the bounded poll stops before publishing a receipt. A successful receipt continues to require exact Worker traffic, container version, image, capacity, and terminal rollout proof.

## Verification

- Passed: 61 focused Cloudflare receipt and deploy-helper tests, including delayed provider-detail convergence and fail-closed exhaustion.
- Passed: `apps/cloudflare` package typecheck.
- Passed: cyclomatic-complexity diff; the changed receipt owner remains below the threshold with no new debt.
- Passed: `git diff --check` and parent inspection of the complete source, test, documentation, and plan diff.
- Pending: exact-head required GitHub Actions, merge, protected production deployment, exact release certification, and independent runtime-backlog recovery proof.
