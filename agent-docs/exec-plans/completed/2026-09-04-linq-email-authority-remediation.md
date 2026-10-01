# Complete Linq email identity ownership

Status: completed

## Outcome and authority

Continue PR #2820 under the explicit session handoff. The previous candidate
is clean at `034c4125ad526af1562cb0bf8dbdc70999b865c1`; its prior workers remain
paused. The user authorized remediation of the accepted review findings and
prioritized minimal, composable architecture.

## Owners and evidence

Activation clears the pending encrypted participant while the new identity
keeps only a blinded key. The identity owner must retain the encrypted source.
The canonical verified-email writer currently ignores Linq handle ownership,
and linked-account removal leaves that handle effective. Fix these existing
owners and preserve contact-before-member lock ordering.

Historical ciphertext migration preserves its authenticated member and semantic
field binding. The user approved retaining the existing participant-contact
encryption context, avoiding production keys or a migration service. Unsupported
historical sources fail migration before publishing partial identity state.

## Product UX Patch

- Outcome: email conversations keep the same member through activation and
  key rotation, while explicit email removal revokes matching routing authority.
- Reaches: new email senders, existing pending contacts, same-member email
  linking, conflicting Settings linking, optional phone/Telegram secondary
  email enrichment, stale unlink requests, and bearer/live identity drift.
- Proof: focused owner regressions, real PostgreSQL atomicity and concurrency,
  authenticated ciphertext continuity, and Web typechecking. The broader PR's
  real-Codex journey remains on Hold under PR #2802's ownership.

## Implementation and completion

1. Preserve encrypted email identity source using existing private-field codecs.
2. Centralize email ownership checks and locks in the identity/email writers;
   reject primary conflicts and skip conflicting optional secondary enrichment.
3. Clear matching identity and route authority atomically on unlink, preserving
   any replacement handle. Resolve new-member creation from the live snapshot.
4. Remove duplicate creation work only where the actual planner and legacy
   writer paths prove it unreachable; do not weaken one-grant admission.
5. Run focused tests, PostgreSQL proof, typecheck, lint, privacy and complexity
   checks. Review the candidate, archive this plan with the scoped commit,
   update the draft PR, and follow exact-head review eligibility.

No new service, queue, state machine, or dependency is needed. Each request
touches one normalized email with at most two indexed read candidates in one
bounded transaction. No collection fanout or new provider call is introduced.

## Deployment and stopping boundary

Apply the additive schema before the new Web writer. Old identity mutation
writers cannot safely revoke a new email identity, so establish the Web writer
rollback floor before admitting those identities. Do not execute deployment,
production writes, or a secret-dependent backfill from this local task.
Keep the PR draft while shared assistant proof or required review is missing.

## Remediation result

- The identity owner writes the blinded handle and encrypted normalized source
  together. SQL copies only the matching same-member pending ciphertext;
  active-only, missing-source, ambiguous, orphaned, and cross-owner history
  aborts the migration transaction. Real cryptography proves member and field
  binding, and the identity regression proves re-derivation after key rotation.
- Canonical email writes check Linq ownership before member or email mutation.
  Live-email drift fails before new-member creation. Optional secondary email
  conflicts preserve phone authentication. Unlink clears only the exact
  matching identity and route; a two-client PostgreSQL race proves the next
  inbound cannot restore the revoked member.
- Retained the legacy pending-route collision recovery: the base implementation
  creates pending email routes without the new outer email contact lock. The
  suggested complete removal is not valid for that supported writer overlap.
  No further creation lifecycle or compatibility owner was added.
- The 290-test routing/auth/settings slice, 191 additional identity/schema
  regressions, focused ciphertext test, nine
  migration checks, two PostgreSQL identity/concurrency checks, Web typecheck,
  focused ESLint, and complexity guard passed. All 213 migrations applied
  through the normal deployment runner on a fresh isolated local database.
- Product UX: remediation boundaries are Ready under direct proof; the complete
  PR remains Hold because PR #2802 still owns the required shared real-Codex
  journey. A fresh full exact-head ReviewGPT round and required broad CI remain
  pending until that proof is available. The existing changelog item covers the
  same unreleased member outcome.
Updated: 2026-09-04
Completed: 2026-09-04
