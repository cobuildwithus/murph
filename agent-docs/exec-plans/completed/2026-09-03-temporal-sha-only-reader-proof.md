# Restore Temporal SHA-only reader proof

Status: completed
Created: 2026-09-03
Updated: 2026-09-03

## Goal

- Restore the public Temporal compatibility controller to the SHA-only
  supported-reader proof format emitted by private protected CI, while keeping
  private legacy-reader lifecycle drift detection private and fail-closed.

## Success criteria

- The exact production failure from PR 2741 validates against the corrected
  public verifier without weakening exact run, reader, producer, or request
  binding.
- Focused controller tests prove deterministic SHA-only hashing and rejection
  of mismatched proofs, duplicate readers, failed jobs, and stale identities.
- Durable public documentation describes the cross-repository proof boundary
  accurately.
- Focused verification, complexity, docs drift, exact-head CI, and the final
  ReviewGPT gate are complete, subject to the known bootstrap requirement that
  this controller correction must reach public `main` before its own required
  Temporal status can turn green.

## Scope

- In scope: the public proof digest, its focused Node tests, the owning durable
  Temporal reference, and one Frog record for the crossed-controller failure.
- Out of scope: private reader discovery, private lifecycle-state validation,
  production Temporal workflows or deployments, runtime behavior, PR 2683's
  broader release-admission design, and any required-status bypass.

## Constraints

- Technical constraints: keep public verification independent of private live
  routing policy; retain exact public SHA, request id, producer digest, reader
  job, private run, workflow, and private-main binding.
- Product/process constraints: use an isolated PR, preserve the existing draft
  PR's ownership, run the high-risk final review gate, and do not merge or push
  public `main` without explicit authority.

## Risks and mitigations

1. Risk: accepting an attestation that omits private lifecycle drift evidence.
   Mitigation: private CI continues to bind lifecycle state in its separate
   internal digest; public CI validates only the intentionally shared immutable
   reader SHA set and all existing public inputs.
2. Risk: weakening proof identity while repairing the wire format.
   Mitigation: change only reader-digest construction and preserve every
   existing job/run/head/producer/request guard with focused negative tests.
3. Risk: colliding with draft PR 2683.
   Mitigation: avoid that branch, keep this patch narrowly compatible with its
   current public surface, and document the overlap for later rebase handling.

## Tasks

1. Reproduce and record the exact crossed public/private digest mismatch.
2. Restore SHA-only reader hashing and simplify attestation validation.
3. Align focused tests and durable documentation with the corrected boundary.
4. Run focused verification, ReviewGPT, and PR checks; publish the dependency
   PR and obtain explicit merge authority before changing public `main`.
5. After the correction reaches `main`, rerun PR 2741's Temporal compatibility
   check and confirm its exact head is green.

## Decisions

- Use the original SHA-only cross-repository format. The private owner already
  checks legacy state at setup and final attestation with a separate digest;
  exposing that state in the public digest duplicates private policy and is the
  proven source of the mismatch.
- Do not modify PR 2683 or fold the controller correction into PR 2741.
- Keep one fixed synthetic SHA-only digest vector in the public test suite so a
  future wire-format suffix change cannot pass through order-only assertions.

## Verification

- `node --test scripts/hosted-orchestration-compatibility.test.mjs`
- A local production-shaped exact-proof diagnostic using the redacted PR 2741
  artifact digest and job shapes; private reader revisions stay out of durable
  public artifacts.
- `pnpm complexity:diff`
- `pnpm docs:drift`
- `pnpm typecheck`
- `git diff --check`
- Final ReviewGPT against the exact pushed dependency head.
- Exact-head GitHub checks after the dependency PR is Ready; all checks other
  than the self-bootstrap Temporal status must be green before merge authority
  is requested.

Completed local evidence:

- The corrected verifier accepted the exact failed PR 2741 run shape with all
  three successful private reader jobs; private revision values were neither
  printed nor persisted.
- `node --test scripts/hosted-orchestration-compatibility.test.mjs`: 37 passed.
- `pnpm typecheck`: passed.
- `pnpm complexity:diff`: passed with zero debt and maximum 19 unchanged.
- `pnpm docs:drift`: passed after refreshing the durable-doc index.
- `git diff --check`: passed.
Completed: 2026-09-03
