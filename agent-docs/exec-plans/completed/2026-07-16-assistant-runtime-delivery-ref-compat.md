# Assistant runtime delivery-ref compatibility

Status: completed
Created: 2026-07-16
Updated: 2026-07-16

## Goal

- Establish read/send and encrypted-checkpoint compatibility for a narrowly
  assistant-owned generated-delivery subtree under assistant runtime state,
  before any writer or cleanup starts using that path.

## Success criteria

- Persisted outbox and hosted delivery records accept the exact assistant-owned
  runtime subtree, and retry dispatch can read it, while initial file-send
  preparation and every other hidden vault ref remain rejected.
- Active files under the new subtree remain present in hosted checkpoint plans.
- Previously legal generic files under `exports/**`, including the abandoned
  top-level candidate from PR 764, remain ordinary vault data and stay in hosted
  checkpoints. Portable support bundles retain them when they do not match an
  existing global file-type exclusion such as the archive-file filter.
- This phase does not change assistant generation guidance, delete files, or
  alter user-visible delivery behavior.
- Focused tests, typechecks, coverage-write, CI, ReviewGPT, deployment gates, and
  a secret-safe production convergence check pass.

## Scope

- In scope: one exact runtime-owned path contract, persisted and hosted delivery
  codecs, retry-read compatibility, snapshot/portable regression proof,
  compatibility docs, and the phase-one deploy.
- Out of scope: generated-file cleanup, writer guidance, top-level path
  reservation, snapshot exclusions, Priority processing, prewarming, or provider
  latency work.

## Constraints

- Never infer ownership from a previously generic top-level path.
- Keep the existing generic hidden-ref rejection intact except for the one exact
  assistant runtime subtree.
- Do not add a state machine, migration row, ownership registry, dual write, or
  recovery service.
- Phase two may start only after the deployed runner fingerprint proves this
  reader has converged.

## Tasks

1. Add the exact assistant-runtime staging ref contract and retry-only reader,
   persisted-outbox, and hosted-side-effect exceptions.
2. Add focused rejection, checkpoint-retention, and legacy generic-path proofs.
3. Document the temporary compatibility phase and rollback floor.
4. Run required verification and completion audits; commit and publish a PR.
5. Deploy the accepted phase-one head and prove fleet convergence before phase
   two switches writers or cleanup.

## Decisions

- Reuse `.runtime/operations/assistant/**`, the existing assistant operational
  state owner, rather than claim a new top-level vault namespace.
- Split deployment into reader compatibility first and writer/cleanup activation
  second. This keeps active phase-two delivery refs readable by every converged
  runner and gives rollback a bounded phase-one floor.

## Verification

- Focused shared-ref, persisted-outbox, hosted-side-effect, retry-read,
  checkpoint-retention, and portable-package tests passed. The package test
  also proves the pre-existing archive exclusion applies equally inside and
  outside the abandoned generic prefix.
- Full affected owner suites passed for runtime-state, operator-config,
  hosted-execution, assistant-engine, and assistant-runtime; all affected
  package typechecks and relevant builds passed.
- Coverage-write closed the public-request, persisted-reload, and serialized
  parser gaps. The shared exact-ref helper reached 100% statements, branches,
  functions, and lines, and the final independent audit had no remaining
  finding.
- Scenario integrity passed for 204 scenarios, 11 sample inputs, and 28 golden
  directories. Documentation drift, package boundaries, dependency policy,
  `git diff --check`, and added-line privacy/credential scans passed.
- The diff-aware lane passed its guards, affected typechecks, and the changed
  owner suites but could not complete the untouched CLI reverse-dependent tail:
  unrelated CLI integration files repeatedly exhausted their exact 60-second
  budgets while several independent worktrees were running Vitest on the same
  host. The directly changed CLI packaging test passed 37 tests with one skip;
  pushed-head CI remains the isolated fail-closed verification gate.
- ReviewGPT, CI, protected-main deployment gates, exact runner fingerprint
  checks, and secret-safe production monitoring remain publication/deployment
  gates rather than implementation work.

## Deployment concerns

- No web deploy, database migration, or persisted-schema change is required.
- Phase one is additive and user-invisible. Phase two must not deploy until all
  production runners advertise the phase-one bundle fingerprint.
- Once phase two can create an active runtime-owned staged ref, do not roll below
  the phase-one reader until no such active delivery remains.
Completed: 2026-07-16
