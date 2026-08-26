# PR 2207 current-main integration

Status: active
Created: 2026-08-25
Updated: 2026-08-25

## Goal

Ship the Experiment, Habitat, progress-card, and Murph Age recovery slice on
current `main` with bounded factual diagnostics and no duplicate projector,
journey policy, or validation owner.

## Evidence

- Exclusive ownership is proven at clean local, remote, and PR head
  `dd89d35094e9bff6df05ba73f7ba826554130122`.
- Review round one rejected an unrelated progress-card repair command and a
  duplicate Murph Age Zod-error owner; both were deleted.
- The required retrospective established the durable ownership rule: domain
  code reports bounded facts, while day-four and final-review callers choose
  their own continuation.
- Review round three found operation-inferred Habitat source classification and
  shared issue-presence stage inference. Later commits classify from core-owned
  facts, preserve owner-written stages, and centralize Murph Age public paths.
- Review round four found that Habitat accepted impossible calendar dates at
  the CLI option boundary, then misclassified the downstream core rejection as
  stored-record corruption. The option owner now reuses `isStrictIsoDate` and
  returns the existing value-free `recordedAt` validation error before writing.
- The current head has focused post-remediation proof but no exact-head final
  review.
- Current `main` was merged at `18c38c8474`; stale shared projector, prompt,
  validation, and test copies were removed so the resulting tree differs from
  `main` only in the domain slice, authored plans, and measured bundle allowance.
- Focused verification passes: 172 domain tests, 70 prepared built-CLI tests,
  14 runner bundle tests, all six affected package typechecks, prepared runtime,
  CLI package shape, and both docs gates.
- Canonical runner assembly passes all eight parity probes. The Vault CLI is
  9,508,913 bytes against a 9,519,455-byte budget; the runner is 11,335,455
  bytes against an 11,393,617-byte budget.

## Design

- Current `main` owns the shared projector, CLI recovery guidance, and generic
  diagnostics.
- Experiment, Habitat, progress-card, and Murph Age owners retain only stable
  codes, truthful stages, terminality/retryability, finite public paths, and
  value-free domain facts they can prove.
- Existing day-four and final-review automation callers retain their distinct
  text-only continuation. Add no registry, retry manager, repair channel,
  validator, state owner, or compatibility layer.

## Tasks

1. [done] Merge current `main`, resolving duplicate foundation history by ownership.
2. [done] Prove the resulting tree is current `main` plus only the domain slice.
3. [done] Run focused tests, affected typechecks, prepared/package-shape checks, docs
   gates, and production runner bundle/parity proof.
4. [done] Push the exact candidate, update the PR contract, and run a sensitive full
   ReviewGPT round with the complete prior finding ledger and retrospective.
5. Resolve the accepted calendar-date finding, close the plan, admit the exact head to required
   CI, prove a clean current-base merge, merge, and retire the worktree.
