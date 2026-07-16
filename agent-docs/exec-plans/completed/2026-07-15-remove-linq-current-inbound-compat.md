# Remove Linq Current-Inbound Compatibility

Status: completed
Created: 2026-07-15

## Goal

Delete the retired Web-side `currentInbound` Linq egress compatibility proof
and its derived provider-dispatch idempotency fallback after the #627 runner
fleet drain, while making the current `authorityCheckOnly` discriminator
explicit and required end to end.

## Invariants

- Keep `authorityCheckOnly: true` as the authority-only preflight and
  `authorityCheckOnly: false` as the final atomic provider-dispatch claim.
- Final provider entry requires an explicit idempotency key.
- Preserve exact `answeredMailboxItemIds` authority and the bounded recent-100
  mailbox recovery path.
- Preserve member, direct/group audience, route, provider-reply, dispatch-fence,
  and signup-welcome authorization checks.
- Do not change the unrelated webhook `currentInboundReply` read-receipt proof,
  delivery-time mailbox consumption, or legacy personal-home route repair.

## Plan

1. Remove the legacy engagement-route parser, proof type/branches, and
   `legacy-current-inbound:` provider-dispatch key fallback.
2. Require an explicit boolean `authorityCheckOnly` at the Web/runtime wire
   boundary and make every current producer state `true` or `false` directly.
3. Replace legacy tests with current-protocol success/failure coverage and
   update the deployment guide with the #627-or-newer rollback floor.
4. Run focused Web and assistant-runtime tests, stale-reference checks,
   diff-aware verification, and hosted-local Linq scenarios when the local
   environment can support them.

## Deployment

Current production runners already omit `currentInbound`, send explicit
`authorityCheckOnly`, and use explicit provider-dispatch idempotency keys. The
Web hard cut is independently deployable, but after it ships the
Cloudflare/runner rollback floor is #627 or newer. Immediate rollout is not
required because the request shape is already deployed and fingerprint
admission prevents stale runner bundles from receiving user work.

## Verification

- Focused hosted-Web Linq engagement tests.
- Focused assistant-runtime callback, channel-activity, scheduled-route, and
  workspace-runner tests.
- Stale searches for egress `currentInbound` and `legacy-current-inbound`.
- `git diff --check` and truthful `pnpm test:diff` coverage.
- Hosted-local `linq-delivery`, `linq-webhook`, and
  `linq-scheduled-reminder` scenarios after the deterministic lanes pass.

## Verification outcomes

- The full diff-aware lane passed assistant-runtime (1,692 tests), Web (5,212
  tests plus typecheck, lint, development smoke, and production build), and
  Cloudflare (1,829 Node tests plus Workers).
- The required coverage-write audit added only boundary proof for the retired
  `currentInbound` key fallback, explicit provider-claim identity, authority-
  only no-claim behavior, foreign-member group routes, signup-welcome claims,
  and Cloudflare boolean transport.
- The post-audit focused runs passed Web 30/30, assistant callbacks 169/169,
  Cloudflare 130/130, and the retained read-receipt/mailbox-consumption slice
  2/2; Web, assistant-runtime, and Cloudflare typechecks also passed.
- Stale egress-path searches and `git diff --check` passed. The unrelated
  webhook `currentInboundReply` proof remains covered and unchanged.
- Hosted-local scenarios were blocked by the pre-existing runner static-boot
  closure failure rather than this patch; PR CI and exact-head ReviewGPT remain
  the final external gates after publication.
Updated: 2026-07-15
Completed: 2026-07-15
