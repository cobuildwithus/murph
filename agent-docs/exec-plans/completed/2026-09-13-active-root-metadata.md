# Consolidate active crypto-root metadata preparation

Status: completed
Created: 2026-09-13
Updated: 2026-09-13

## Outcome and invariant

Reduce existing-root metadata preparation from discovery plus per-domain reads to one bounded snapshot. Preserve signatures, member/domain/root bindings, request-scoped key zeroization, provider concurrency, and locked transaction-time authority revalidation. No latency saving in milliseconds is promised.

## Owner and evidence

The existing domain-root store owns preparation and revalidation. Its baseline control/ingress batch test expected three metadata queries; the updated test requires one. Keep the snapshot private to its prepared-candidate object; no caller-owned cache, persisted state, schema, or protocol is added.

## Scope and failure behavior

Consolidate active-root metadata only. Historical-root batching, signature micro-optimization, telemetry, placement, and typing lifecycle are out of scope. Missing roots retain ephemeral candidate creation. Rotation and insertion races must still fail exact revalidation and use existing fresh preparation. Old/new Web builds share unchanged storage and consumers.

## Tasks

1. Consolidate bounded active-root reads through the existing crypto owner.
2. Prove existing/missing subsets, binding/signature failures, stale snapshots, cache reuse, and transaction authority with synthetic fixtures.
3. Run focused crypto/onboarding proof, Web typecheck and lint, and complexity review.
4. Review the full diff, close this plan, commit, open a draft PR, then mark Ready and start required final ReviewGPT concurrently with CI.

## Verification

- Passed 232 tests across eight focused suites: domain-root store and authority lock, Linq root prewarm, prepared mailbox append, Starter enrollment, Stripe reconciliation, prepared secure-box, and runtime crypto-context route.
- Passed Web typecheck and prepared typecheck after the final test edits.
- Focused ESLint passed with one pre-existing unused-parameter warning in the existing routing-write test fixture.
- Complexity guard passed: zero debt, maximum 19 before and after, no hotspots above 20. Diff whitespace check passed.
- Local PostgreSQL read-only proof passed for Prisma enum-array serialization and the bounded query shape, using synthetic values only.
- Parent reviewed bindings, cache scope, zeroization, candidate ordering, live authority revalidation, failure draining, and all changed paths. No production traffic or data was used.
- Changelog not applicable: internal metadata query consolidation, without a demonstrated end-to-end member latency change or new product behavior.
- Implementation and local proof are complete. Final ReviewGPT and required exact-head CI will be recorded on the PR; this plan does not claim those pending gates passed.
Completed: 2026-09-13
