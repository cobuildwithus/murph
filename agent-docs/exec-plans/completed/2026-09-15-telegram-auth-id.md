# Remove redundant Telegram authentication ID generation

## Outcome and invariant

Remove the Better Auth adapter warning from Telegram proof creation while preserving
browser-bound, purpose-bound, expiring, single-use login and credential proofs.

## Cause and design

The shared Telegram proof creator supplies a random ID without `forceAllowId`.
Better Auth 1.7.3 warns, prints a stack, discards that ID, and generates another.
Proof readers select by the nonce identifier; no consumer needs the discarded ID.
The account-linking commit repeats the same discarded-ID pattern.
Remove both explicit IDs and their unused imports. Keep the existing encrypted adapter,
record shape, nonce generation, expiry, and transactional consumption unchanged.
No schema, dependency, new abstraction, provider call, or state owner is needed.
Old and new Web instances already use library-generated IDs, so deployment order
is unconstrained and existing proofs remain readable across the change.

## Verification and delivery

- Reproduce the warning through the production routes and real encrypted adapter
  against an isolated local PostgreSQL database, using synthetic provider proof.
- Verify distinct persisted IDs and no ID warning/stack for login and account linking.
- Run the Telegram composition suite, affected Web typecheck, focused lint, and
  complexity guard. Review the entire diff and privacy boundary.
- Commit, open a draft PR, mark the stable candidate Ready, and start required
  ReviewGPT concurrently with CI. Merge after passing required gates and verify
  the managed Web deployment.

## Status

Implementation and regression proof complete. The regression failed before the
fix on the Better Auth ID diagnostic. After both corrections, all 20 Telegram
PostgreSQL composition cases passed. An earlier run had five local timing/pool
failures; the complete rerun passed with unchanged timeouts. Focused lint and
complexity guard pass; no source hotspot exceeds 20. `pnpm --dir apps/web typecheck` passed.
Parent diff review confirms no auth authority, schema, or provider-input change.
Final PR review, exact-head CI, merge and managed deployment remain delivery gates.
No member-visible behavior change is intended, so no public changelog entry.
Status: completed
Updated: 2026-09-15
Completed: 2026-09-15
