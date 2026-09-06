# Consume prepared domain-root candidates once

Status: completed
Created: 2026-09-06
Updated: 2026-09-06

## Goal and design

Second independent PR from the ReviewGPT admission design review: consume the
candidate map Linq already prepared instead of repeating active-domain discovery
for control and ingress. Standalone callers retain discovery; prepareMissing:
false still prohibits provisioning. No new state, flags, cache, or owner.

## Invariants and proof

Keep exact scoped-root identity, user/domain validation, winner drift checks,
candidate reuse, caller zeroization, failure draining, and KMS outside transactions.
Use the real crypto owner with synthetic KMS and SQL statement recording to prove
one discovery instead of three, then cover supplied/empty maps and standalone
preparation. Run crypto and Linq tests, Web typecheck, complexity and docs checks.
Parent review precedes publication; final ReviewGPT runs alongside exact-head CI.

## Scope

Only domain-root preparation and its Linq caller. Identity decryption is PR #2998;
locked admission consolidation is the next independent patch. Provider chat
classification and outreach history selection retain current behavior.

## Result and verification

Supplied candidates replace nested discovery; standalone discovery and explicit
no-provisioning behavior remain. Exact candidate/root validation is unchanged.
The existing Linq mock now uses the renamed prepared-candidate input.

Real crypto-owner composition records discovery 3 -> 1 and existing-root total
preparation SQL statements 5 -> 3. The same new count tests fail against baseline
source. KMS decryptions remain two; revalidation adds none; returned plaintext
copies are zeroized. Empty supplied candidates cannot authorize a missing root.
Focused crypto/Linq suites: 264 tests pass. Web typecheck and complexity guard
pass; source complexity debt stays unchanged. No production latency claim.

Parent review: this is one input-contract refinement and removal of redundant
work, with no new owner, persistent state, framework, or dependency. The shared
helper retains its ordinary callers. Final ReviewGPT and CI follow publication.
Completed: 2026-09-06
