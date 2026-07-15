# Clinical Records PR 631 Review Fixes

Status: completed
Updated: 2026-07-14

## Goal

Close the accepted exact-path ReviewGPT findings in PR 631 without expanding
the dormant backend/control-plane slice into the later user-facing Records UI.

Success means a Clinical Records retrieval resumes from bounded vault-owned
progress after foreground preemption, stable page identity does not depend on
randomized cursor ciphertext or URL normalization, and disconnect authority is
rechecked immediately before each irreversible vault write boundary.

## Constraints

- Keep web as the connection, run-authority, provider-egress, and credential
  owner; credentials and patient identifiers must not enter runtime state.
- Keep vault-usecases as the only raw/canonical clinical persistence owner.
- Store at most the already-bounded in-progress snapshot in the encrypted
  workspace operational state; never put raw FHIR in Postgres, Temporal,
  prompts, logs, or mailbox payloads.
- Use one checkpoint schema in a dedicated portable
  `.runtime/operations/clinical-records` subtree and the existing atomic
  runtime-state file primitive. Do not add a database table, queue, retry
  generation, service, or dependency.
- Preserve the valid import, idempotent replay, conflicting replay, foreground
  reply, and single-generation evidence-retention invariants.
- User-facing Records pages and the typed conversation connect operation remain
  the dependency-ordered next PR slice.

## Implementation

1. Add a bounded, schema-validated Clinical retrieval checkpoint in the vault
   usecase public entrypoint, atomically written with private permissions after
   each accepted page and cleared on terminal completion or rejection.
2. Resume assistant-runtime retrieval from that checkpoint instead of replaying
   completed families/pages from the provider.
3. Preserve the provider's exact validated next-link text as provenance identity
   while using a parsed URL only for network policy and fetching; derive request
   fingerprints and page hashes from the exact text.
4. Make runtime cursors durable for the lifetime of their active bound
   run/generation rather than expiring independently of the run.
5. Pass one narrow current-run assertion into vault import and invoke it directly
   before raw persistence and directly before canonical mutation.
6. Add focused regressions for preemption resume, stable randomized-cursor
   replay identity, exact next-link hashing, and disconnect at both write
   boundaries.

## Verification

- Focused Clinical Records web, assistant-runtime, and vault-usecase tests.
- Typechecks for web, vault-usecases, assistant-runtime, and affected public
  dependency owners.
- Dependency, public-entrypoint, boundary, cycle, unsafe-logging, privacy,
  prohibited-cast, secret, and diff checks.
- Required coverage-write and security/privacy completion audits for the final
  exact diff.
- Hosted CI, conflict/thread checks, and one new exact-head ReviewGPT round only
  after the PR-specific fixes are pushed.

Completed local evidence:

- The diff-aware workspace lane passed all affected typechecks, package tests,
  package-boundary checks, hosted architecture/privacy guards, web verification,
  Cloudflare verification, and the production web build.
- Focused Clinical Records proof passed for web retrieval (19 tests), hosted
  runtime orchestration (29 tests), vault execution/checkpointing (17 tests),
  and runtime-state portability (1 targeted test).
- Target-file coverage reached 94.70% statements / 89.24% branches for hosted
  orchestration, 91.66% / 81.81% for vault execution, and 81.25% / 74.06% for
  web retrieval. Package-global coverage commands for the focused runtime,
  vault, and runtime-state selections exited only because unselected files do
  not satisfy package-wide thresholds; every selected test passed.
- The required security/privacy completion audit found no evidence-backed
  medium-or-higher issue. The coverage-write pass added only direct cycle and
  checkpoint lifecycle/permission proof.

## Deployment Compatibility

The checkpoint is local encrypted workspace operational state with no external
schema or mixed-version writer. Web cursor parsing accepts only the new
run-bound representation produced by the same deployed web build; the feature
remains dormant until the later Records UI/assistant slice. The PR stays stacked
on its runtime dependency and must land after that base PR.
Completed: 2026-07-14
