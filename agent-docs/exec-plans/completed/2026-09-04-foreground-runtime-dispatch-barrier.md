# Foreground Runtime Dispatch Barrier

Updated: 2026-09-04

## Goal

Guarantee that the authorized Web-direct foreground request reaches the fetch
boundary before the durable Temporal signal can take the fresh startup fence,
without putting the Cloudflare response on the provider reply path.

## Root cause

The first recovery candidate invoked the async direct-wake helper before
Temporal, but the control client awaited Vercel OIDC before calling `fetch`.
Returning from the callback therefore proved helper invocation, not request
dispatch, and Temporal could still win the startup race.

## Architecture

- Keep mailbox-owner and active-access validation in the existing signal owner.
- Let the existing control client report the exact synchronous `fetch` boundary.
- Return one direct-wake handle with independent dispatch-readiness and full
  completion promises.
- Await dispatch readiness for at most one second before Temporal; keep full
  completion attached to the existing after-response owner.
- Add no persisted state, wire field, queue, retry owner, or dependency.

## Verification

- Prove authorization completes before the dispatch callback and hold the real
  response open after dispatch.
- Prove the signal owner awaits an asynchronous foreground barrier.
- Prove Linq and Assistant Ask dispatch before Temporal without waiting for the
  Cloudflare response.
- Prove pre-dispatch failure, dispatch-budget expiry, abort, and Temporal
  failure retain bounded durable recovery.
- Run focused tests, package and Web typechecks, changed-file lint, docs drift
  and gardening, complexity, diff, privacy, exact-head CI, and final ReviewGPT.

## Deployment

Deploy the private worker timeout upgrade first. Then rerun the public
exact-private-main compatibility gate, deploy Web, and verify a bounded cold
foreground trace shows the direct attempt dispatched before Temporal with no
startup-grace stall.
Status: completed
Completed: 2026-09-04
