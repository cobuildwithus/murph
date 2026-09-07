# Simplify locked Linq admission

Status: completed
Created: 2026-09-06
Updated: 2026-09-06

## Outcome

Third patch from the ReviewGPT design: one live member resolution under existing
transaction owners; no repeated home-row locking or route mutation for a clean
exact binding. Keep mutable access, metadata comparisons, ownership precedence,
quota, replay, routing repair, and receipt semantics. No new state or flags.

## Implementation and proof

Consolidate selected-member authority before live discovery, retain one current
access decision, and remove duplicated routing revalidation work. Reuse the
existing home policy and unchanged-binding predicate. A pending conflict still
requires the normal repair owner, with sorted nonblocking member locks and one
cleanup statement. Empty conflict sets require no cleanup statement.

Verify composed operation counts, maintenance and conflicting-owner cases,
prepared identity/routing drift, consent/activation/replay, and PostgreSQL races.
Run Web typecheck, complexity and docs checks, then parent review and a focused
PR. Final ReviewGPT and exact-head CI remain completion gates.

## Constraints

Identity preparation and root discovery are independent PRs #2998 and #3000.
Canonical provider classification and outreach selection retain existing policy.
Never replace selected-member SKIP LOCKED with a blocking acquisition.

## Result

Consolidated prepared control-root/member/identity validation into one admission
step before live discovery. Removed the second discovery pass, repeated member
locks, and the pre-lock access read. Existing runtime access remains authoritative.
Own-message diagnostics no longer query access solely to populate a log field.
The existing policy has an explicit entry point for callers already owning the
member lock; standalone callers retain its locking wrapper.

An exact binding uses the existing unchanged predicate and returns its stored
participant after checking competing pending routes. Maintenance still falls
through to the existing writer. Empty conflict sets issue no cleanup; nonempty
sets retain sorted nonblocking member locks and use one identical cleanup update.

The clean composed dispatch fixture fails against baseline source with identity
discovery 2 versus 1, routing findMany 3 versus 1, raw route reads 3 versus 2,
selected-member row locks 4 versus 1, chat locks 2 versus 1, and cleanup updates
2 versus 0. Binding upserts remain zero and the canonical provider GET remains
one. These named mock-Prisma counts do not represent all physical SQL or an
end-to-end latency measurement. Preflight and crypto owners are mocked here.

Deleted one mock-only thread race that invented a group route after the chat
lock was already held. The separate thread-route suite retains the reachable
group-created-after-preflight and false-direct provider classification proofs.
Prepared-owner mismatch tests now expect control-root validation before discovery;
the existing bounded retry still rejects without accepting mailbox work.

PostgreSQL proof passes all 20 tests, including competing pending owners with and
without a home route, busy-owner rejection, successful repair, and clean replay.
The prepared planner count fixture and binding maintenance matrix cover the new
skip path; existing dispatch, home policy, and thread suites cover consent,
activation, identity/routing drift, duplicates, and ownership conflicts.

Final local checks and parent review are recorded in the PR. ReviewGPT and
exact-head CI run after push; no merge or deployment is part of this task.
Completed: 2026-09-06
