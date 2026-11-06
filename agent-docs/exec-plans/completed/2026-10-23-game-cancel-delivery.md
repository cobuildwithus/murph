# Preserve cancellation notice delivery authority

Status: completed
Created: 2026-10-23

## Outcome and evidence

The requested read-only Astra review found two concrete composed delivery gaps:
void games no longer funded their group runtime, and the new notice identity
was not admitted by dispatch-time game authorization. Correct both current
owners so an existing game-funded room can generate its cancellation notice,
and dispatch still requires the cancelled event, bound room and original pair.

## Scope and invariants

Use the existing capped room allowance; no private-player activation or extra
budget. Pending cancellation receipts authorize only their bound room until
provider dispatch, with the existing seven-day post-game upper bound. Ordinary
expiry grants nothing. Preserve roster, suspension, consent and allowlist checks.
No new state, protocol, migration or dependency. Fix forward only.

## Tasks and proof

- Extend funding selection and exact dispatch validation.
- Run composed Postgres access/usage tests, game suites, typecheck and guards.
- Refresh PR evidence; eragon ReviewGPT alongside exact-head CI; merge and verify
  production admission, health and deployment identity.

Product UX: Ready. The final run passed all ten game Postgres suites plus
provider-dispatch authority tests (92 tests in 11 files). Web typecheck,
complexity:diff, logs:guard and docs:drift passed. The focused real-model notice
proof from the initial plan remains valid; its builder and runtime inputs did
not change. Both concrete Astra findings are corrected at existing owners.
Release gates continue in PR #4329 and the external status file.
Updated: 2026-10-23
Completed: 2026-10-23
