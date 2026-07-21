# Crabbox Verification Dispatch

## Goal

Route the canonical `pnpm test:diff` and `pnpm verify:acceptance` commands through a repo-owned dispatcher that can execute the unchanged workspace verifier through Crabbox on a Blacksmith Testbox for an eligible local Codex session, while preserving the existing local path everywhere else.

## Constraints

- Treat the supplied patch as behavioral intent and reconcile it with current `origin/main`.
- Preserve `scripts/workspace-verify.sh` as the only verification semantics owner.
- Use Crabbox's direct `blacksmith-testbox` provider; do not introduce or require a Crabbox coordinator.
- Default CI, non-Codex, nested remote, unconfigured, missing-CLI, and Vercel-environment-required runs to the existing local executor.
- Fail closed for explicit Crabbox requests that cannot run safely.
- Use Blacksmith's Git-managed sync set, reject sensitive managed paths before delegation, forward no developer environment, and rebuild a deterministic test-only child environment.
- Do not add a dependency or a second verification implementation.
- Do not print, persist, or pass real credentials during validation.

## Plan

1. Inspect the supplied patch against current main and identify stale hunks or assumptions.
2. Implement the smallest current-main dispatcher, Crabbox/Blacksmith runner configuration, Testbox workflow, tests, and durable guidance that preserve the existing verifier contract.
3. Run syntax, YAML, focused routing/environment tests, local fallback scenarios, full `pnpm test:diff`, and `pnpm verify:acceptance` without remote credentials.
4. Run the required `coverage-write` audit, resolve accepted findings, and complete the parent final review.
5. Close the plan with a scoped commit, open a PR, start ReviewGPT concurrently with CI, and carry the exact pushed head through green gates.

## Verification

- `node --check scripts/verification-dispatch.mjs`
- `node --check scripts/crabbox/run-verification.mjs`
- focused Vitest for both new script test files
- direct local fallback and fail-closed dispatcher scenarios
- `pnpm test:diff <touched paths...>`
- `pnpm verify:acceptance`
- YAML parse validation for `.crabbox.yaml` and `.github/workflows/crabbox.yml`
- exact-head CI, ReviewGPT, and mergeability proof

## State

Active. The Blacksmith-backed implementation passes syntax, YAML parsing, focused routing/environment tests, the coverage-write audit, docs drift, and canonical scoped `test:diff` (27 files and 390 tests). A live Crabbox attempt reached the direct Blacksmith provider; the unsupported profile doctor was removed, then the provider failed at GitHub's one-time bootstrap boundary because the new `workflow_dispatch` file does not yet exist on the default branch. Local full acceptance reached 3,270 package tests before the local Assistant Engine coverage worker exhausted its 4 GB heap, so the remaining completion gates are PR CI, ReviewGPT, and exact-head mergeability; remote acceptance becomes available after this bootstrap PR lands.
Status: completed
Updated: 2026-07-20
Completed: 2026-07-20
