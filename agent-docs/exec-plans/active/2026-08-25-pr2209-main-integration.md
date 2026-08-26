# PR 2209 current-main integration

Status: active
Created: 2026-08-25
Updated: 2026-08-26

## Goal

Ship the clinical and explicit-health recovery slice on current `main` with
finite schema-owned public paths, value-free validation errors, and no duplicate
generic projector, validation framework, or recovery state owner.

## Evidence

- Exclusive ownership is proven at clean local, upstream, and PR head
  `27da5c188de873010ce859531ce05365049fc813`.
- The branch is based on the pre-squash foundation history, while current
  `main` already owns the shared projector, CLI guidance, and generic recovery
  tests. Integration must retain only the health-domain slice and its measured
  bundle allowance.
- Prior review established that dynamic health qualifier keys stop at finite
  schema-owned parents and that validation rejects before canonical writes.
- The current head has historical focused and bundle proof but no current-main
  integration or exact-head final review.
- Current `main` was merged at `08cbdc0f97`; stale broad-path redaction and its
  inbox expectation were restored to the main-owned bounded-diagnostic behavior.
- Focused verification passes: 137 health, contract, usecase, and CLI tests;
  14 runner bundle tests; Contracts, Vault Usecases, and CLI typechecks;
  generated contract verification; prepared runtime; CLI package shape; and
  both docs gates.
- Canonical runner assembly passes all eight parity probes. The Vault CLI is
  9,512,634 bytes against a 9,519,180-byte budget; entry is 805 bytes and the
  static startup closure is 25,155 bytes. The runner is 11,348,803 bytes
  against an 11,393,617-byte budget.
- ReviewGPT round three found four hand-maintained public-field/index catalogs
  duplicated facts already owned by strict Zod schemas. The finding is accepted
  and corrected by deleting those catalogs, retaining Zod-produced finite path
  segments, and stopping only at the dynamic `qualifiers` and
  `requiredQualifiers` record boundaries.
- The correction deletes 63 net production lines and removes the unused
  per-call issue-mapper branch. Focused proof covers fixed nested `slug`,
  `targetId`, evidence, and condition-history paths plus unknown-key and dynamic
  qualifier non-echo/no-write behavior. Fourteen focused tests and the affected
  Vault Usecases and CLI typechecks pass.
- Exact corrected-head production assembly passes all eight parity probes. The
  Vault CLI is 9,509,571 / 9,519,180 bytes with an 805-byte entry and
  25,155-byte static closure; runner total is 11,346,915 / 11,393,617 bytes.
- The next full-snapshot audit found that the blood-test command's manual Zod
  union branch-count matcher could misclassify an invalid supplied
  `referenceRange.low` as a missing range and collapse fixed-field failures to
  the result root. The accepted correction selects the least-error union
  branch, preserves each concrete issue leaf, deduplicates only tied
  alternatives, and collapses those alternatives to their common finite
  parent. It deletes 13 net production lines and adds no shared parser,
  reflection layer, sanitizer, projector, retry owner, or state.
- Prepared runtime generation, all 24 blood-test save cases, CLI typecheck, CLI
  package-shape verification, and `git diff --check` pass. The built-CLI proof
  covers malformed `referenceRange.low`, analyte, slug, unit, simultaneous
  fixed leaves, missing value/text alternatives, a genuinely empty reference
  range, and invalid flags. Every case retains value non-echo and zero ledger
  writes.
- ReviewGPT round five found that the first-reviewed candidate also added strict
  enum schemas for five read-only `list --status` filters. That behavior is
  unrelated to validation-before-write recovery and duplicated the existing
  query owners plus generic non-empty status option. The finding is accepted.
- The correction deletes `listStatusSchema` across the descriptor, registry,
  and command-factory layers, the five-family enum switch, and the dedicated
  unsupported-status test. Valid filters continue through the existing generic
  option and unchanged query services. Regenerated schema, command types, and
  skill hash now describe a non-empty string instead of a second enum owner.
  The correction is 12 additions and 104 deletions before this plan update and
  adds no replacement concept, branch, service, state, or compatibility path.
- Focused correction proof passes 40/40 health descriptor, valid status-filter,
  clinical recovery, non-echo, and no-write journeys; 24/24 built blood-test
  recovery cases; 14/14 bundle-boundary cases; Vault Usecases and CLI
  typechecks; prepared runtime; package shape; and both docs gates.
- The exact production runner assembly remains blocked before packaging by the
  pre-existing assistant-engine CLI-manifest subprocess deadline: both the full
  assembly and one unmodified isolated owner retry timed out after 60 seconds
  loading `vault-cli --llms-full --format json`. No timeout or production source
  was changed. The focused bundle owner is green, and the prior exact reviewed
  production head passed all eight assembly parity probes; required CI remains
  the next broad proof for the corrected candidate.

## Round-four retrospective

- The original bounded requirement was to reject invalid clinical-import and
  explicit-health payloads before any canonical write, report only finite
  schema-owned public fields, avoid echoing dynamic keys or values, and align
  the immunization contract schema with the writable domain surface. It did
  not require a new generic projector, reflection mechanism, shared sanitizer,
  recovery service, state owner, or independently shippable subsystem.
- The first-reviewed candidate was
  `9245fba99877079e75b8c342aa6bbfea48444c51`; the round-four candidate is
  `171f1f1f68cc3166f7d54b9a6b47164faf502ffc`. Comparable accounting moved
  from source `449/29` to `456/44`, tests `560/20` to `1062/28`, docs `164/0`
  to `292/0`, generated `503/13` to `609/13`, and total `1679/63` to
  `2423/86` added/deleted lines. Production net size therefore decreased from
  420 to 412 lines: eight fewer lines. Most gross growth is focused tests,
  authored plans, and generated contract proof rather than production
  architecture.
- The retained concepts are the existing strict Zod schema owners, their
  finite path segments and safe array indices, owner-local issue mapping, the
  existing shared generic projector, and the existing canonical write paths.
  The correction removed the duplicate generic repair builder and secondary
  projection channel, four hand-maintained public-field catalogs, the unused
  mapper-selection path, the broad path redactor, and the PR-local generic
  projector.
- Continue with the current smaller, Zod-derived, owner-local design. Do not
  introduce reflection, a shared sanitizer, another state owner, or a split
  that separates the health schemas from their validation and no-write proof.
  The remaining work is integration and verification of this one cohesive
  health-domain slice, not further architectural expansion.

## Design

- Current `main` remains the sole owner of generic projection and assistant
  retry guidance.
- Clinical-import and explicit-health schema owners retain only finite field
  catalogs, safe array indices, fixed constraints, and structured Zod issues
  needed to classify their own failures.
- Add no reflection layer, repair service, retry manager, logging pipeline,
  compatibility shim, alternate envelope, or state owner.

## Tasks

1. [done] Merge current `main` and resolve duplicate foundation history by ownership.
2. [done] Prove the resulting tree is current `main` plus only the health slice,
   authored plans, generated health contracts, and measured bundle allowance.
3. [done] Run focused health tests, affected typechecks, generated-contract checks,
   prepared/package-shape checks, docs gates, and canonical runner parity proof.
4. Push the exact candidate, retarget the PR to `main`, update the PR contract,
   and run a sensitive full ReviewGPT round with the prior finding ledger.
   [done through the next full-snapshot finding and local correction]
5. Resolve accepted findings, close the plan, admit the exact head to required
   CI, prove a clean current-base merge, merge, and retire the worktree.
