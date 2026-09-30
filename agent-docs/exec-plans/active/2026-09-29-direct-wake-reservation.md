# Prevent failed direct wakes from reserving runtimes

Status: active
Created: 2026-09-29
Updated: 2026-09-29

## Outcome and invariant

A failed best-effort Web wake must not reserve an unstarted runtime and delay the durable Temporal wake. Postgres remains the sole ownership authority; Cloudflare requests admission only once it can process the request. Preserve exact-generation fencing and authorization.

## Evidence and design

The Web helper claims before calling the control client. A transport failure leaves a starting owner that competing requests preserve for thirty seconds. Reproduce with the real control client, a failed synthetic fetch, and local Postgres before removing the early claim. The existing Worker admission callback handles requests without a supplied admission; no new state, retry, cleanup, or protocol is needed.

## Scope and compatibility

Change only the public Web wake caller and its proof. Retain the optional Worker admission contract for already deployed Web callers. Old and new Workers already accept requests without admission. No migration or private orchestration change is required.

## Product UX: Patch

Outcome: preserve prompt recovery when the direct wake fails.
Reaches: Linq, Telegram, and Assistant Ask direct wake callers; cold and warm runtime ownership.
Proof: failed transport leaves no starting reservation; the next durable claim succeeds immediately. Preserve ordinary dispatch, bounded retry, denied admission, and concurrent-owner fencing.

## Tasks

1. Reproduce failed-dispatch ownership locally on latest main.
2. Delete Web preclaim and update focused tests and the runtime contract.
3. Run focused Web/Worker tests, local Postgres proof, Web typecheck and complexity review.
4. Complete parent review, changelog, draft PR, ReviewGPT and required CI; merge/deploy under existing authorization.

## Verification

- Local Postgres regression failed on the unchanged base: rejected synthetic fetch left an unaccepted starting owner with no target. The same test passes after removing the preclaim, for both empty and retained-target ownership (2 cases).
- Web focused suites: direct wake, owner route/release, mailbox wake, webhook wake, Linq dispatch and changelog rendering: 294 checks passed.
- Worker processing/summary: 57 checks passed, including unchanged startup-fence preservation and canonical claim handling.
- `pnpm --dir apps/web typecheck:prepared`: passed after building the existing importers declarations required by the fresh checkout.
- `pnpm complexity:diff`: passed; changed function maximum decreased from 18 to 14, no hotspots above 20.
- Parent review: no new authority, state, retries or cleanup. Remove unused admission test mocks and their fixture. Product UX Ready at the changed boundary; end-to-end delivery behavior is unchanged.
- Hot path: move the existing claim transaction from Web-before-dispatch to the existing signed Worker-to-Web callback (one extra serial network round trip per direct attempt, at most two direct attempts). Callback remains bounded by the configured callback timeout and command budget; Temporal's path is unchanged. Failed dispatch performs no ownership transaction. Database fanout and provider input are unchanged.
- Mixed versions: deployed Worker and current Worker both accept omitted admission; their processing implementation is identical at this boundary. Existing supplied-admission readers remain for older Web instances during convergence.
- Pending: PR, ReviewGPT, required CI and authorized production deployment.
