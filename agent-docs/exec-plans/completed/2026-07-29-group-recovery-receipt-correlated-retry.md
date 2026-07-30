# Receipt-correlated group recovery retry

## Outcome

Keep critical-line group recovery usable after the recovery provider reports a
failed send, without allowing a degraded backup line to be selected for an
unrelated retry.

## Proven cause

The provider-failure projection marks the pinned backup line `warning`, while
the retry path currently searches only the healthy proactive pool. A genuine
new intro therefore cannot reuse the pinned sender even though the failed
delivery and warning projection identify the same provider receipt.

## Scope

- Expose the delivery's hashed last-provider-event identity to the transport.
- Resolve the pinned recovery line by exact lookup.
- Permit its warning state only when the line's latest receipt is the exact
  failed receipt being retried.
- Continue to reject disabled, unconfigured, unreadable, provider-degraded,
  hard-blocked, unhealthy, or subsequently failed lines.
- Keep the same sender, backup number, copy variant, and original capacity
  reservation across attempts.
- Add focused storage and transport regressions, including the production
  failure-projection coupling.
- Update the hosted runtime and deliverability contracts.

## Invariants

- No queue, scheduler, schema, new state owner, or roster mutation.
- Exact source-event replays remain suppressed.
- A later provider success still converges the recovery tuple.
- A retry never consumes another proactive-conversation reservation.
- Provider event identities remain hashed internal lookup keys.

## Steps

1. Add the exact receipt-correlated line resolver and delivery intent field.
2. Route failed recovery retries through that resolver.
3. Add focused and production-shaped regression coverage.
4. Run focused checks and the canonical completion verification.
5. Commit, push, update the PR, and verify exact-head CI.

## Evidence

- Focused Linq storage, transport, and observability coverage passed: 187 tests.
- The production-shaped PostgreSQL recovery suite passed: 16 tests.
- Web typecheck and scoped ESLint passed.
- `MURPH_VERIFY_EXECUTOR=crabbox pnpm verify:acceptance` passed on the frozen
  candidate in Testbox `tbx_01kyr7fgz483czjm687jg4skqw`; the delegated
  [Actions run](https://github.com/cobuildwithus/murph/actions/runs/30503425776)
  completed with exit code 0 after workspace coverage, Web build, and
  Cloudflare Workers verification.
- ReviewGPT round 5 identified the failed-receipt/line-health coupling fixed by
  this plan. A sixth formal round requires explicit approval under the review
  retry cap.

Status: completed
Updated: 2026-07-29
Completed: 2026-07-29
Completed: 2026-07-29
