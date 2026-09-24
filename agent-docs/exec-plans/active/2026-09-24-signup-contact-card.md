# Share contact cards across Linq signup paths

Status: active
Created: 2026-09-24
Updated: 2026-09-24

## Outcome and ownership

Every supported iMessage signup path attempts native Linq contact sharing after
an outbound message is confirmed delivered. Direct conversation replies cover
instant signup and members who join through the app or website. Existing invite
signup sharing remains supported in direct and group threads.

The Web provider-receipt owner triggers the effect after commit. Canonical home
routing binds direct recipients; the existing per-chat reservation owns duplicate
suppression. No new state, queue, schema, runtime protocol, or model behavior.

## Evidence and design

The existing trigger depends on invite-link delivery bookkeeping, which excludes
instant opening replies and runtime signup welcomes. Generalize the direct-chat
trigger independently of that bookkeeping. Reconcile receipt-before-acceptance
welcomes after their callback materializes the home route.

Use Linq's documented rolling 24-hour native-share cadence. Explicit requested
vCard sends keep their existing 90-second throttle. Preserve image-free native
card preflight, service eligibility, and post-response provider work. Provider
failure remains observable and cannot fail the delivered reply; a later active
day can retry. Linq cannot guarantee handset display or contact saving.

## Product UX

- Outcome: Murph's native identity card follows delivered iMessage activity.
- Reaches: instant text signup, app/website phone welcomes, existing direct
  members, and existing invite direct/group signup. Email-only accounts wait
  until they establish an iMessage route; SMS/RCS cannot show a native card.
- Proof: provider-shaped webhook and callback tests, exact chat authority,
  acceptance-only and failure suppression, receipt ordering, daily concurrency
  guard, and unchanged explicit vCard behavior.
- Done when: supported paths reach the native provider boundary after delivery
  without duplicate daily pushes or blocking the original reply.

## Verification and delivery

1. Implement the shared direct-chat post-delivery trigger and daily native gate.
2. Add focused webhook/callback/transport regressions; run tests and Web typecheck.
3. Update the durable delivery contract and member changelog; review complete diff.
4. Run complexity/doc checks, commit the scoped change, and complete applicable
   external review and PR gates if publishing the candidate.

Web-only rollout; existing reservations and provider events remain compatible.
No production messages, bulk backfill, or deployment is part of local proof.
