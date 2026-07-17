# PR 752 main reconciliation

Status: completed
Created: 2026-07-16
Updated: 2026-07-16

## Goal

- Reconcile PR 752 with the current `origin/main` while preserving both the
  reviewed sleep-loop behavior and all newer mainline prompt, runtime, docs,
  notification, usage, personalization, and WHOOP-capacity behavior.

## Success criteria

- The branch contains the current `origin/main` without unresolved conflicts.
- Conflict resolutions are semantic unions rather than choosing one branch.
- Focused conflict-surface tests, changed-surface checks, CI, and ReviewGPT pass.
- The PR remains open and merge-ready.

## Scope

- In scope: only merge-conflicted files, the coordination plan, PR metadata,
  verification, and clean-merge proof.
- Out of scope: new sleep features, unrelated refactors, or deployment changes.

## Tasks

1. Merge current `origin/main` without committing and resolve each conflict.
2. Prove the resolved prompt/runtime/docs behavior with focused tests and diff
   inspection.
3. Close this plan in the merge commit, push, and complete CI/ReviewGPT gates.

## Verification

- Resolved both conflicts as semantic unions; no unmerged entries remain.
- Focused assistant, device-import, Health Commons boundary, clinical-record,
  and vault-usecase tests pass.
- Typechecks pass for core, assistant-engine, assistant-runtime,
  hosted-execution, clinical-records, vault-usecases, and web.
- Scenario integrity, docs drift, Health Commons generation, the hosted runner
  bundle, and a cold 184-page web build pass.
- The original affected `test:diff` lane passed, including all affected package
  tests, package boundaries, 437 web test files, 106 Cloudflare test files,
  both app builds, lint, and app verification.
- After `main` advanced, the exact conflict-surface `test:diff` rerun passed all
  global guards and 19 affected package typechecks. Its monolithic
  assistant-engine process first exceeded the local 4 GiB heap; an 8 GiB
  retry then produced cross-suite warm-process timeouts. The exact 192-test
  runtime file passed in a fresh process, ruling out the apparent regression.
- Fresh latest-main checks pass: 94 assistant prompt/skill tests, 73
  assistant-runtime tests, 140 importer tests, 163 core tests, 533 query tests,
  357 device-sync tests, 48 health-metric tests, 8 contract tests, 240 web
  tests, 203 Cloudflare node assertions, and the hosted-local Linq
  first-contact E2E (7 passed, 2 intentionally skipped). The E2E's first cold
  start spent its five-minute hook budget building the runner; its warm rerun
  reused that verified bundle and passed.
- A final reminder-window mainline delta merged without conflicts; its assistant
  cron, notification, and prompt suites pass (229 tests), along with the
  assistant-engine typecheck and docs drift guard.
- Final diff/privacy checks and the pre-commit mainline refetch pass. The
  post-commit merge-base proof, ReviewGPT correction review, and PR CI remain
  before handoff.
Completed: 2026-07-16
