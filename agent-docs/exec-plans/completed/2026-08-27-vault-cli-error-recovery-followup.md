# Vault CLI error recovery follow-up audit

Status: completed
Created: 2026-08-27
Updated: 2026-08-27

## Goal

- Find and correct the remaining reachable Vault CLI failure paths that still
  hide the useful cause or repair action from a machine caller after the
  2026-08-23 recovery work landed.
- Preserve the established invariant that `VaultCliError.context` is the only
  structured recovery source and that CLI commands remain thin projections of
  owner-classified failures.

## Success criteria

- Every accepted finding has a complete throw-to-built-CLI trace or focused
  reproduction proving the current generic or misleading envelope.
- Each fix is owner-local, preserves bounded value-free detail, and adds no new
  state owner, retry manager, compatibility layer, or broad error framework.
- Focused owner tests and final built-CLI regression tests prove stable code,
  stage, retryability, hint or field path, and privacy non-echo where relevant.
- Feynman raw and verified finding records contain only synthetic, public-safe
  evidence; required ReviewGPT gates and exact-head CI resolve with no accepted
  finding left open.

## Scope

- In scope:
  - Registered `vault-cli` leaves and the direct `packages/vault-usecases`,
    `packages/core`, `packages/query`, `packages/importers`, and provider/client
    boundaries that determine their machine error envelope.
  - Failure paths outside an existing mapper or before an inner `try/catch`,
    beginning with corrupt stored-state reads in `event edit`.
  - Generic `vault_error` fallbacks, wrong retryability or stage, silent or
    misleading success, and concrete privacy leakage in final machine output.
- Out of scope:
  - Hosted member-facing runtime behavior, production database investigation,
    unrelated CLI UX, and speculative exhaustive classification of unknown
    exceptions.
  - Reworking already-actionable errors solely to replace an `UNKNOWN` code.

## Constraints

- Technical constraints:
  - Extend the existing domain/usecase mapper at the owning boundary; never
    serialize arbitrary error context or echo submitted values, provider bodies,
    raw vault content, credentials, absolute paths, or identifiers.
  - Preserve native Incur validation and the built-CLI output contract.
- Product/process constraints:
  - Prefer deletion, reordering, or one existing mapper call over new
    abstractions. Reject speculative findings and fixes whose complexity exceeds
    the proven defect.
  - Work in this isolated task worktree, preserve unrelated worktrees, and use
    review-only subagents for independent audit slices.

## Risks and mitigations

1. Risk: broad wrapping turns genuine internal failures into misleading domain
   errors.
   Mitigation: accept only errors proven to originate from a known owner and
   keep unknown fallback behavior unchanged.
2. Risk: useful detail exposes private input or local paths.
   Mitigation: construct fixed messages, paths, stages, and hints from owner
   metadata and add final-envelope non-echo assertions.
3. Risk: audit scope expands into a generic framework.
   Mitigation: implement only independently verified reachable paths and keep
   each correction at its current mapper/call site.

## Tasks

1. Reconcile the prior audit checklist with current `main` and inventory all
   remaining generic/error-swallowing command paths.
2. Run independent read-only audits over CLI wrappers, owner mappers,
   external/provider boundaries, and built-CLI coverage.
3. Verify candidate findings with full code traces or focused synthetic
   reproductions and record raw/verified Feynman evidence.
4. Implement the smallest accepted owner-bound fixes and regression proof.
5. Run focused tests/typechecks, inspect the complete diff, and finish the
   preliminary specialist plus final ReviewGPT, exact-head CI, mergeability,
   merge, and guarded worktree-retirement gates.

## Decisions

- The audit is a follow-up against live `main`; the 2026-08-23 research artifact
  is a checklist, not current implementation truth.
- Product UX effort is a Patch: failures already exist and the intended change
  only restores truthful, actionable recovery information to the same machine
  caller without adding a new action or interaction.
- No persisted state or deployment protocol is introduced.
- Five independent read-only subagent slices covered CLI wrappers, owner
  mappers, provider clients, command contracts, and built-CLI recovery proof.
  The parent accepted only findings with a complete reachable trace or focused
  reproduction.
- The affected-package verifier exposed one adjacent hosted-runtime abort race:
  foreground preemption after a completed clinical-records read escaped as a
  generic abort. The accepted fix only restores the existing stable domain code
  at that synchronous owner boundary; in-flight abort behavior is unchanged.

## Verification

- Commands to run:
  - Focused Vitest files for every touched owner and CLI envelope.
  - Built `packages/cli/dist/bin.js` synthetic scenarios for each accepted
    failure class.
  - Package typecheck or `pnpm test:diff` selected from the final touched paths.
  - `git diff --check`, required ReviewGPT gates, exact-head GitHub checks, and
    `git merge-tree --write-tree HEAD origin/main`.
- Expected outcomes:
  - Previously generic/misleading paths return the exact stable repair envelope,
    while unknown and sensitive content remains bounded and redacted.

### Completed evidence

- Focused local regressions passed for the touched CLI, core, device client,
  operator-config, vault-usecase, and hosted-runtime owners. The final two stale
  broad-suite expectations were corrected and then passed independently:
  `record-service-coverage.test.ts` (18/18) and the selected Incur help contract
  (1/1).
- Canonical remote `pnpm test:diff` passed on candidate tree
  `482f6f5afd0187061cc3de8dd6ded2ea49b4abde` in Testbox
  `tbx_01m12w8sx1vy8v0cekrw7ksg7a`.
- That exact-tree run passed repository guards, generated-artifact checks,
  affected typechecks, CLI Vitest (408/408), vault-usecases (401/401), core
  (823/823), device-syncd (1,298/1,298), assistant-runtime (2,534/2,534),
  Cloudflare verification (2,703 passed, 2 skipped), and hosted Web verification
  (11,343 passed, 571 skipped), including lint and production build.
- Remaining completion work is exact-head ReviewGPT, required GitHub checks,
  mergeability, merge, and guarded worktree retirement.
Completed: 2026-08-27
