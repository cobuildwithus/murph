# Frog Autofix Round 9 Remediation

Status: completed
Created: 2026-08-12
Updated: 2026-08-12

## Goal

- Preserve an exact or ancestor parent-owned human handoff after a foreign PR
  body edit, and remove mutable GitHub issue prose from implementation-model
  authority and availability.

## Success criteria

- Baseline and handoff recovery use one trusted metadata body: authoritative
  remote presentation or the captured, validated parent-local body.
- Recovered local handoffs return awaiting-human before canonical review,
  readiness, merge eligibility, merge, or issue closure.
- Specialist and final PASS markers remain recoverable only from the current
  parent-owned remote body.
- Fresh implementation ReviewGPT uses only the exact committed friction binding
  and repository instruction hierarchy and does not request or use the GitHub
  connector.
- Unrelated hostile issue comments, attachments, and links cannot repeatedly
  block the oldest queue item; an actually boundary-weakening committed task or
  candidate still fails closed.

## Scope

- In scope: existing PR-body/baseline/handoff recovery, implementation prompt
  and connector plumbing, edit-only foul-play wording, focused production-shaped
  tests, directly affected architecture/security/reliability/verification docs,
  and the next exact-head review and CI cycle.
- Out of scope: a new queue, state record, scheduler, credential, service,
  autonomous finding-remediation loop, or product-runtime behavior.

## Tasks

1. [x] Route review ancestry and handoff through one trusted metadata body.
2. [x] Delete mutable GitHub-content collection from fresh implementation work.
3. [x] Add focused exact/ancestor handoff and prompt-boundary regression proof.
4. [x] Update owner docs and run the fixed local verification suite.
5. [x] Prepare the closed plan and scoped candidate for commit, push, PR metadata
   refresh, and the next exact-head ReviewGPT/CI cycle.

## Verification

- `pnpm exec vitest run scripts/frog-autofix.test.ts --config scripts/vitest.config.ts --no-coverage`
- `pnpm test:diff <changed Frog files>`
- `pnpm typecheck`
- `pnpm docs:drift`
- `bash -n scripts/frog-autofix`
- `scripts/frog-autofix verify-permissions`
- `scripts/frog-autofix scan`
- `git diff --check`

## Results

- Focused Frog authorization/recovery coverage passed 38/38.
- Diff-aware repository-tool coverage passed 35 files and 563 tests.
- Full workspace typecheck, docs drift, shell syntax, native worker permission
  proof, and the read-only live admission scan passed.
- The repository has no installed Prettier binary; `git diff --check` and the
  repository-owned syntax/diff-aware gates supplied formatting validation.
Completed: 2026-08-12
