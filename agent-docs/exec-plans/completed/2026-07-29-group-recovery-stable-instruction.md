# Group recovery stable-instruction remediation

Goal:
- Resolve the accepted ReviewGPT round-4 receipt-finality finding without
  inventing monotonic provider receipt state.
- Preserve genuinely new-intro recovery while ensuring every bounded provider
  attempt carries the same recovery instruction.

Constraints:
- Reuse the existing delivery and transport owners.
- Keep the failed receipt non-final because a later delivered receipt can win.
- Reuse the pinned healthy sender, rendered backup number, deterministic copy,
  and original proactive-conversation capacity reservation.
- Fail closed if the pinned sender is no longer healthy.
- Add no schema, queue, scheduler, lifecycle owner, polling, or reconciliation.

Decision:
- A new source event may advance after a failed provider-correlated attempt, but
  it advances the provider idempotency key only, not the user-facing recovery
  instruction identity.
- A late delivery can therefore duplicate only the same instruction and cannot
  direct the member to a different backup number or consume another capacity
  slot.

Proof:
- Compose accepted, failed, different new intro, and later delivered behavior
  through the transport boundary.
- Assert one pinned sender, one message body, one capacity reservation, bounded
  provider calls, exact-replay suppression, and later tuple convergence.
- Focused recovery verification: 294 tests passed.
- Web typecheck passed.
- Web lint passed with 21 pre-existing warnings and no errors.
- Canonical `pnpm test:diff` passed on candidate tree
  `a2e3cd5293ea6b6e458b653cca5fd55dad338e62`.
- Canonical `pnpm verify:acceptance` passed on the same candidate tree.
- Exact-head CI and ReviewGPT round 5 remain PR-lane completion gates.

Status: completed
Updated: 2026-07-29
Completed: 2026-07-29
