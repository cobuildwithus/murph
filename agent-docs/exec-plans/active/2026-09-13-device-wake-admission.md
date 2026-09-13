# Admit connection work during historical retries

## Outcome and invariant

New work for an already connected device must enter the existing worker while
older history waits for its provider retry. Preserve every accepted job, exact
backoff, connection epoch, and the single durable continuation per connection.

## Evidence and owner

The runtime mailbox serializes connection work behind its retained history
owner. Plain dirty hints already transfer into that owner, but a subsequent
connection-established wake with explicit jobs remains an ordering barrier.
Reproduce this with synthetic mailbox items before changing production code.

## Design

Extend existing mailbox admission and durable claim composition for compatible
same-epoch connection work. Reuse the retained wake's job hints and canonical
device snapshot; add no queue, scheduler, persisted field, or provider policy.
Keep lifecycle changes, mismatched identities, attempted/recording work, unknown
semantics and ambiguous job identities as barriers. Preserve retry cursors and
deadlines across foreground preemption, failed execution and cold restore.

## Proof and delivery

- [x] Failing synthetic admission reproduction: due connection work selected no owner.
- [x] Minimal implementation and 47 focused identity/barrier tests.
- [x] Composed mailbox execution, canonical import, foreground preemption,
  durable restoration and eventual exact-backoff completion; 137 runtime tests pass.
- [x] Assistant-runtime typecheck, unchanged complexity debt, parent review
  and 17 changelog render/fragment tests pass.
- [ ] Required ReviewGPT and exact-head CI, merge and protected deployment.
- [ ] Verify production progress using read-only metadata.

## Product UX

Connecting another source under an existing provider must start its accepted
work without waiting for empty historical-resource retries. Existing history
keeps its retry deadline; reconnect and disconnect authority stays canonical.
Replay those journeys through the runtime mailbox and worker. Model prompts,
tools, reply content and user-facing UI are unchanged; deterministic device
execution and production progress define the outcome.

Implementation status: ready. Review, exact-head CI and production delivery are
separate gates; this implementation record does not claim production recovery.
The documented changelog test entrypoint required the already-recorded Frog
workaround: generate fragments, then run the repository-root Web test config.
No new developer-friction entry was needed.
