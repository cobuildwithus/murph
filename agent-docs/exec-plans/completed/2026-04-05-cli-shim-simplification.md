# Simplify generated CLI shims to thin built-entry launchers

Status: completed
Created: 2026-04-05
Updated: 2026-04-05

## Goal

- Simplify generated `murph` and `vault-cli` shims so they behave like thin launchers instead of mini runtimes.
- Preserve repo-root recovery for moved checkouts, but remove shim-owned build repair, discovery special-casing, and stdio/signal supervision branches that can distort real CLI behavior.

## Success criteria

- Generated shims only resolve the repo root, require `packages/cli/dist/bin.js`, and `exec` the built CLI with `SETUP_PROGRAM_NAME`.
- Missing build artifacts fail with one explicit remediation message instead of auto-repair attempts.
- Piped stdin reaches the built CLI unchanged through the shim.
- Focused setup-cli tests cover direct exec, moved-checkout recovery, missing-build failure, and piped stdin behavior.
- Durable runtime docs describe the thin-shim contract.

## Scope

- In scope:
- `packages/cli/src/setup-services/shell.ts`
- `packages/cli/test/setup-cli.test.ts`
- Durable docs for CLI runtime/shim expectations
- Out of scope:
- Changing the built CLI entrypoint itself
- Reworking broader host bootstrap flows beyond shim generation
- Refreshing already-installed user shims outside test coverage and docs

## Constraints

- Technical constraints:
- Preserve current repo-root recovery behavior so moved checkouts still work.
- Do not add another wrapper layer around the built CLI to replace the removed behavior.
- Product/process constraints:
- Keep the user-facing failure path explicit and deterministic.
- Preserve unrelated dirty worktree edits and commit only touched paths.

## Risks and mitigations

1. Risk: Simplifying the shim could regress moved-checkout recovery or direct CLI launch behavior.
   Mitigation: Keep repo-root discovery, add focused regression tests, and prove the shim still launches the built entrypoint.
2. Risk: Removing repair/supervision branches could leave stale tests/helpers behind and obscure the new contract.
   Mitigation: Delete dead scaffolding, update durable docs, and capture focused proof for stdin and missing-build behavior.

## Tasks

1. Replace the generated shim with a thin repo-root resolver plus direct `exec` path.
2. Rewrite shim tests around the new contract and remove supervision/repair-era scaffolding.
3. Update durable runtime docs to describe the simplified shim behavior.
4. Run focused shim verification, then required audit review and scoped commit flow.

## Decisions

- Keep repo-root recovery in the shim so moved checkouts still find the live repo.
- Remove shim-owned auto-build repair, discovery-command branches, and signal/stdin supervision rather than trying to harden those wrapper paths further.
- Make missing build output a loud operator error with explicit build commands instead of an implicit repair attempt.

## Verification

- Commands to run:
- `pnpm exec vitest run packages/cli/test/setup-cli.test.ts --coverage.enabled=false -t "CLI shim execs the built CLI directly without invoking repair helpers"`
- `pnpm exec vitest run packages/cli/test/setup-cli.test.ts --coverage.enabled=false -t "CLI shim recovers from a moved repo checkout when invoked inside the new checkout"`
- `pnpm exec vitest run packages/cli/test/setup-cli.test.ts --coverage.enabled=false -t "CLI shim fails loudly when the built entrypoint is missing and does not try to repair it"`
- `pnpm exec vitest run packages/cli/test/setup-cli.test.ts --coverage.enabled=false -t "CLI shim passes piped stdin directly to the built child process"`
- `pnpm typecheck`
- Expected outcomes:
- Focused shim tests pass and prove the new direct-exec behavior.
- `pnpm typecheck` passes, or any failure is documented if clearly unrelated.
- Actual outcomes:
- All four focused shim tests passed.
- `pnpm typecheck` passed.
- Direct scenario proof passed: generating fresh temp shims from the current source and piping `printf '{'` through `vault-cli recipe upsert --input - --format json` now reaches the built CLI and returns `invalid_payload` / `recipe payload must contain valid JSON.` instead of the old false empty-stdin error.
- Required `simplify` audit passed with no findings after the exec-time `SETUP_PROGRAM_NAME` proof was tightened.
- Required final completion review passed with no findings.
Completed: 2026-04-05
