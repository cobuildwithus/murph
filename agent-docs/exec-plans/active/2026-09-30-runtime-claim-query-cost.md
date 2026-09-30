# Reduce runtime admission database calls

Status: active
Created: 2026-09-30
Updated: 2026-09-30

## Outcome and invariants

Reduce serial database work before direct and Temporal runtime wakes without changing eligibility, ownership, fencing, recovery, or callback contracts. Keep the member lock before the eligibility statement so waiting claims observe committed consent withdrawal. Postgres remains the sole runtime owner.

## Evidence and smallest change

A default fresh claim currently performs eight explicit database operations: gate, member lock, suspension, consent, access, owner lock, owner write, and a post-commit routing read. Existing claims omit the write. Reuse the canonical access predicate and explicit-withdrawal predicate in one eligibility read; propagate the gate already proved in the transaction. Successful target selection and launch preparation can likewise return their proved Postgres route without rereading it.

No new persisted state, protocol, dependency, retry, callback, cache, or scheduler. Completion batching and network callback batching are deferred: they change separate boundaries and are not needed for these savings.

## Scope and proof

- Web owner, command dispatcher, and canonical member-access predicate only.
- Real PostgreSQL before/after operation counts for new, existing and retained owners; target selection and launch preparation; blocked cutover and policy outcomes.
- Preserve direct, Family, owner-backed and participant-backed access, consent granted/missing/revoked, suspension, missing/deleted members, and retention-mode exceptions.
- Reuse two-client lock-order tests and failed-direct-dispatch regression.
- Focused owner/access/route tests, Web typecheck and complexity diff.
- Parent review, requested local Opus optimization/deletion review, exact-head ReviewGPT, PR CI, merge and managed Vercel deployment.

## Product UX

Patch: members keep the same message delivery, access and recovery behavior with less admission database work. Replay cold, active and retained-runtime admission plus blocked/revoked and retention-only paths at the changed boundary. No UI, prompt or provider-input changes; do not claim a measured wall-clock improvement from query counts alone.

## Deployment

Web-only implementation changes preserve command request/response shapes and database schema. Current and preceding Worker/Temporal callers remain compatible; ordinary Vercel deployment owns production activation. Verify exact deployment and bounded runtime error aggregates after promotion.

## Progress

- Candidate implemented in three production files; no HTTP or schema changes.
- Baseline regression run failed at 8 versus 5 operations for cold/retained claims, 7 versus 4 for existing claims, and 5 versus 4 for target selection.
- Real PostgreSQL owner/access proof: 71 passing tests, including consent races in default and retention modes, sponsorship, blocked routing and failed direct dispatch.
- Focused route/release/direct-wake/access tests: 46 passed. Web typecheck passed. Complexity guard passed, maximum 14 with no hotspots above 20.
- Product UX: Ready at the changed admission boundary; no claim of measured wall-clock or delivered-message improvement.
- Changelog: not applicable; internal query-budget reduction with unchanged product behavior and no measured member-visible latency claim.
- Requested Opus final optimization/deletion review is running; ReviewGPT, CI and production rollout remain pending.
