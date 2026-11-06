# Release a first-turn claim that never reached the provider

Status: active
Created: 2026-11-06
Updated: 2026-11-06

## Outcome and scope

Release empty first-turn reservations after five minutes on replay, later-event
admission, or egress. Keep exact-attempt fencing, sealed provider identity, held
behavior, and the group fence. Web and the existing delivery ledger own the
change; no schema, runtime, prompt, or message-edit changes.

## Proof and implementation

- Add real PostgreSQL boundary, stale-owner, CAS-race, rollback, and clean-read
  proofs; demonstrate failure before implementation.
- Share abandonment's exact-row/exact-attempt skip; use a first-turn-only stale
  interval and rename the mutating chat check.
- Update the security owner and proof inventory. Run focused PostgreSQL/unit
  tests, prepared Web typecheck, and complexity diff; review the scoped diff.
- Make one local commit, without push or PR, and leave this plan active as
  requested. Final evidence belongs only in the caller's result output.

## Product UX

Outcome: a killed empty claim no longer strands an input or later chat event.
Reaches: exact replay, later input, and runtime egress; fresh, sealed, and held
obligations retain their existing safety boundaries.
Proof: synthetic PostgreSQL journeys with only provider sends mocked, including
rollback and a concurrent owner defeating the skip.
