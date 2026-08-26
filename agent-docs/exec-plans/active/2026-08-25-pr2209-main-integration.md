# PR 2209 current-main integration

Status: active
Created: 2026-08-25
Updated: 2026-08-25

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
5. Resolve accepted findings, close the plan, admit the exact head to required
   CI, prove a clean current-base merge, merge, and retire the worktree.
