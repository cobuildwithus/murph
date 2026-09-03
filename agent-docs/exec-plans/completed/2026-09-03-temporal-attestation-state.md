# Bind Temporal legacy state in public compatibility verification

Status: completed
Created: 2026-09-03
Updated: 2026-09-03

## Goal

- Restore the required Temporal compatibility status by teaching the public
  verifier to validate the bounded legacy-worker state already included by the
  protected private attestation.

## Success criteria

- The verifier accepts an attestation bound to `none`, `active`, or `suspended`
  legacy state only when its exact readers, public SHA, request ID, and producer
  digest also match.
- Unknown state digests and every existing identity or completion mismatch stay
  fail closed.
- Focused tests, typecheck/complexity checks, PR CI, and final ReviewGPT pass.

## Scope

- In scope: public compatibility digest verification, focused contract tests,
  and the matching durable protocol description.
- Out of scope: runtime scheduling, private workflow changes, Temporal routing,
  deployment logic, or a new cross-repository field.

## Constraints

- Technical constraints: preserve the existing attestation job format and
  exact-run identity proof; accept only the private protocol's closed state set.
- Product/process constraints: isolate this CI-only repair from PR #2770 and
  merge it first so #2770 can rerun unchanged.

## Risks and mitigations

1. Risk: accepting an opaque proof could weaken the reader-set binding.
   Mitigation: recompute the proof for each of the three closed protocol states
   from the independently parsed reader jobs and accept only an exact match.

## Tasks

1. [x] Add the closed legacy-state dimension to the public digest verifier.
2. [x] Prove all supported states pass and unknown or mismatched proofs fail.
3. [x] Update the public/private compatibility contract documentation.
4. [x] Prepare the scoped fix for its own PR so #2770 can rerun unchanged.

## Decisions

- Keep the state implicit in the existing proof digest rather than adding a job
  name field or changing the private workflow; the current digest already binds
  the state, and bounded recomputation preserves that contract with less skew.

## Verification

- `node --test scripts/hosted-orchestration-compatibility.test.mjs`
- `pnpm complexity:diff`
- `git diff --check`
- Expected: all pass; production proof values reproduce the private attestation.
- Result: 37/37 focused tests pass; root typecheck, complexity, and whitespace
  checks pass; the bounded `suspended` recomputation exactly reproduced the
  failed live private attestation's reader and proof digests.
Completed: 2026-09-03
