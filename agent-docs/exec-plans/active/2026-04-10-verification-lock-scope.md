# verification lock-scope rework

Status: active
Created: 2026-04-10
Updated: 2026-04-10

## Goal

- Refactor diff-aware verification so ordinary reverse-dependent CLI coverage stays on the source-first lane instead of escalating into the shared built-runtime/package-shape artifact lane, reducing lock contention for parallel agents without weakening explicit acceptance checks.

## Success criteria

- `pnpm test:diff` no longer routes every CLI-affected diff through `run_verify_cli`.
- Built-runtime and package-shape CLI verification still run for explicit CLI-owner or artifact-sensitive changes.
- Durable verification docs and guard tests describe and enforce the new split.
- Required verification and completion audits pass, or unrelated blockers are documented precisely.

## Scope

- In scope:
  - `scripts/workspace-diff-scope.mjs`
  - `scripts/workspace-verify.sh`
  - verification contract tests under `packages/cli/test/**`
  - durable verification docs that describe `pnpm test:diff`
- Out of scope:
  - redesigning all workspace artifacts to per-run roots
  - changing app verify semantics beyond what the diff-aware CLI split requires
  - package manifest or release-topology changes unrelated to verification routing

## Constraints

- Technical constraints:
  - Preserve unrelated dirty worktree edits and overlapping verification/iMessage work.
  - Keep explicit acceptance commands (`pnpm verify:cli`, prepared runtime, package shape) intact.
  - Prefer the smallest durable contract change that materially improves parallel-agent throughput.
- Product/process constraints:
  - Optimize for long-term maintainability, not a one-off local workaround.
  - The resulting verification contract must stay simple enough to explain in repo docs.

## Risks and mitigations

1. Risk: Weakening CLI verification for changes that really do need built-runtime proof.
   Mitigation: Introduce an explicit artifact-sensitive trigger rather than removing acceptance checks broadly.
2. Risk: Drift between script behavior and durable docs/tests.
   Mitigation: Update the verification docs and script guard tests in the same change.
3. Risk: Overlapping in-flight edits under `scripts/workspace-verify.sh`.
   Mitigation: Keep the write set narrow and re-read nearby diff/test expectations before editing.

## Tasks

1. Define the diff-aware routing split between CLI source verification and CLI artifact verification.
2. Implement the routing change in `workspace-diff-scope` and `workspace-verify`.
3. Add or update guard tests and durable verification docs.
4. Run truthful verification, required audits, and finish with a scoped commit.

## Decisions

- CLI built-runtime and package-shape checks remain explicit acceptance gates; the main change is when diff-aware verification invokes them.

## Verification

- Commands to run:
  - `pnpm typecheck`
  - `pnpm test:diff scripts/workspace-verify.sh scripts/workspace-diff-scope.mjs packages/cli/test/release-script-coverage-audit.test.ts agent-docs/operations/verification-and-runtime.md agent-docs/references/testing-ci-map.md`
  - fallback owner coverage commands only if the diff-aware lane proves untruthful or is blocked for unrelated reasons
  - required completion-workflow audit passes
- Expected outcomes:
  - Diff-aware verification keeps CLI reverse-dependent checks source-first by default.
  - Explicit acceptance lanes still cover prepared runtime and package-shape verification when the diff actually needs them.
