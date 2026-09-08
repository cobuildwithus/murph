# Remove unused ordinary Linq identity preparation

Status: completed
Created: 2026-09-06
Updated: 2026-09-06

## Goal

First PR of the reviewed admission simplification: remove identity projection
and historical identity-root warming from ordinary direct messages. Preserve
both pending Family acceptance and accepted replay.

## Outcome and invariants

Outcome: ordinary messaging reaches durable admission and read-receipt dispatch
with fewer operations and less unrelated data access.
Reaches: established direct messaging; preserve Family acceptance, changed routes,
group routing, replay, suspension, consent withdrawal, and crypto rotation.
Proof: focused composed tests, deterministic operation counts, Web typecheck,
parent diff review, ReviewGPT design and final reviews, and required PR checks.
Do not claim a production latency improvement before deployment observation.

## Owners and evidence

Web's Linq service owns preparation and handoff. The planner owns live admission;
the routing store owns route mutations; crypto owns scoped roots and rotation;
mailbox owns dedupe and ordering. Inspection found repeated lookups and locks,
full identity projection without an ordinary-message consumer, and pending-route
cleanup preceding the unchanged-binding return. The existing timing collector
counts preparation and transaction operations together and enumerates only a
bounded prefix; source counts are not measured composed savings.

## Scope and constraints

Refine the implementation and PR boundaries after the requested ReviewGPT design
review. Candidates are removal of unused identity decryption, repeated crypto
metadata discovery, repeated in-transaction lookups, and unnecessary route writes.
Invitation-history querying and provider chat classification need independent
proof before inclusion. No feature removal, production mutations, new persistent
state, services, dependencies, generic frameworks, or parallel admission policy.
Keep KMS outside transactions, exact root revalidation, zeroization, existing
lock order, current access/consent, mailbox replay/ordering, and receipt semantics.

## Tasks

1. ReviewGPT evaluates the concrete proposal against source and tests.
2. Refine and record accepted/rejected candidates and minimal PR boundaries.
3. Implement the selected reductions with operation-count and regression proof.
4. Run focused tests, Web typecheck, complexity review, and applicable doc checks.
5. Open focused PRs with complete evidence; run final ReviewGPT alongside CI.
6. Close this implementation plan for the identity PR; preserve its worktree.
   Root discovery and locked admission receive separate implementation PRs.

## Decisions

- ReviewGPT design review completed against the baseline snapshot; captured
  response metadata verifies GPT-6 Pro. Parent accepts three focused PRs:
  ordinary identity preparation, single-owner root discovery, and consolidated
  locked admission with clean-binding reuse. Each preserves existing owners.
- Keep identity preparation for both pending Family acceptance and accepted
  replay. Keep cross-member pending conflict repair even for unchanged homes.
- Defer outreach query changes as an independent optimization; retain canonical
  provider classification because false-direct group regressions require it.
- The initial proposed savings are hypotheses, not a performance guarantee.
- No new services, state, caches, authority flags, or schema changes are needed.

## Verification

Baseline focused suites: Linq dispatch, established binding, and domain-root store.
Baseline: 278 tests pass; Web typecheck passes.
Candidate proof additionally exercises any changed lock/race and Family branches.
Use the same composed scenario for before/after call counts. Existing error/race
tests must continue proving the invariant, not a duplicate implementation.

## Implementation result

The two identity preparation sites now depend on actionable Family preparation.
Projection joins the existing control preparation lane and its drain/error owner.
Ordinary messages retain raw identity locking/equality and all routing checks.
The regression runs real Family acceptance, phone binding, and encrypted identity
write/readback for an already accepted, expired invite. The ordinary fixture proves
zero identity projection and zero identity-root discovery. It uses the existing
secure-box test codec, so it does not measure KMS decrypt counts. No schema, protocol,
provider-input, dependency, or persistent-state change.

Parent review: the remaining large service functions are existing unrelated
hotspots; this patch does not add complexity debt or a replacement owner. Final
ReviewGPT and exact-head CI run after PR publication under the completion owner.

Verification: 469 focused dispatch/Family tests pass; Web typecheck passes;
complexity guard passes with unchanged debt. The ordinary projection regression
fails on baseline production source (one projection) and passes on the patch
(zero). No production latency or physical SQL-count claim is made.
Completed: 2026-09-06
