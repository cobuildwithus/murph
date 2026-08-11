# Bound Linq group-roster database work

Status: active
Created: 2026-08-11
Updated: 2026-08-11

## Goal

- Preserve live Linq group-participant authority while replacing cap-32
  per-handle identity, activation, and reconciliation work with fixed set-based
  database operations.

## Success criteria

- Provisional unbound-group roster planning resolves phone and verified-email
  handles with at most one narrow read per handle kind and no N-way query
  concurrency.
- Live participant reads select member ids without decrypting unrelated private
  state, resolve durable activation proof for the set, and reconcile the set in
  one database statement.
- Existing cap, ambiguity, route-authority, provider-unavailable, activation,
  partial-roster, and fail-soft reconciliation semantics remain unchanged.
- Maximum-cardinality unit and focused PostgreSQL proof establish the query,
  crypto, selected-field, and reconciliation bounds.
- Focused local checks, the preliminary specialist pass, the sensitive final
  ReviewGPT gate, and exact-head CI are green.

## Scope

- In scope: hosted Web Linq participant member-id lookup, pending group-roster
  planning, live roster presentation, durable activation proof projection,
  participant reconciliation, focused tests, and the matching durable
  architecture bound.
- Out of scope: schema changes, new services or dependencies, provider wire
  changes, caches, queues, generic fanout frameworks, and unrelated group or
  contact flows.

## Constraints

- Reuse existing contact normalization, privacy-key read candidates, activation
  evidence, route authority, roster cap, and participant table ownership.
- A batch result must preserve ambiguity per exact normalized handle; a global
  union of member ids is not sufficient.
- Roster data remains observation, never membership, consent, route, invite,
  delivery, or irreversible-effect authority.
- Keep pooled connection, transaction, and external/crypto concurrency well
  below the shared pool at maximum admitted cardinality.

## Risks and mitigations

1. Risk: batching hides blind-index rotation ambiguity.
   Mitigation: select lookup keys with member ids and resolve each handle's
   complete candidate-key set independently.
2. Risk: set reconciliation removes members from a partial provider roster.
   Mitigation: retain complete-roster-only removal and prove oversized behavior
   in unit and PostgreSQL tests.
3. Risk: raw set writes drift from Prisma timestamp or conflict behavior.
   Mitigation: explicitly bind every owned column and exercise create, refresh,
   unremove, and soft-remove behavior against PostgreSQL.

## Tasks

1. [x] Ask the dedicated ReviewGPT implementation lane for a scoped patch and
   inspect the returned artifact as untrusted intent.
2. [x] Land the smallest accepted set-based owner changes and deterministic
   maximum-cardinality coverage.
3. [x] Replay the cap-32 incident shape locally, run focused PostgreSQL proof,
   typecheck, lint, and diff/privacy checks, and document the final bound.
4. [ ] Commit and push the candidate, open the PR after the guidance PR is merged,
   and run preliminary specialist plus sensitive final ReviewGPT review with CI.
5. [ ] Resolve accepted findings, perform the parent final review, close this plan
   with `scripts/finish-task`, and require green exact-head CI.

## Decisions

- Add no generic collection framework. Extend only the existing participant,
  activation, and reconciliation owners required by this cap-32 path.
- Prefer narrow set reads and one parameterized reconciliation statement over
  concurrency limits around repeated per-item work.
- Keep the optional owner address-book overlay as its existing independently
  bounded presentation path.

## Verification

- Commands to run: focused hosted Web Vitest files for participant lookup,
  group tools, Linq dispatch, and activation; focused PostgreSQL participant
  reconciliation proof; app-local prepared typecheck and scoped lint; direct
  cap-32 call-count replay; `git diff --check`; privacy/path review; exact-head
  required GitHub Actions.
- Expected outcomes: at most two identity reads, at most two activation reads,
  zero identity/activation KMS unwraps, one participant reconciliation
  statement, no per-item database concurrency, and unchanged live authority and
  partial-roster behavior.
