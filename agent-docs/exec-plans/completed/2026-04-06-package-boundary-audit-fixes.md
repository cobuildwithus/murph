# Land supplied package-boundary audit fixes cleanly against the current workspace state

Status: completed
Created: 2026-04-06
Updated: 2026-04-06

## Goal

- Land the supplied package-boundary cleanup patch against the current repo so assistant-engine and vault-inbox stop leaking operator-config and inbox wrapper seams through internal compatibility layers and workspace callers use explicit owner entrypoints instead.

## Success criteria

- The supplied boundary-cleanup intent is landed without reverting unrelated dirty-tree work.
- Assistant-engine and vault-inbox callers import operator-config and explicit owner entrypoints directly where the patch intends.
- Boundary guard coverage is updated to reject the targeted internal wildcard subpaths.
- Required verification for the touched runtime/package surface passes, or any unrelated blocker is documented precisely.

## Scope

- In scope:
  - assistant-engine and vault-inbox source import rewrites from wrapper modules to owner-package entrypoints
  - new explicit public entrypoints needed by the patch
  - removal of now-stale compatibility wrapper modules/exports
  - setup/CLI caller updates and workspace-boundary guard tightening
- Out of scope:
  - broader package publish/private architecture work outside the supplied patch intent
  - wildcard export hard-cuts beyond the specific guardrails and entrypoints touched here

## Constraints

- Technical constraints:
  - Preserve already-dirty package metadata changes from the active package-architecture lane.
  - Treat the supplied patch as intent, not as authority to overwrite unrelated in-flight edits.
- Product/process constraints:
  - Run repo-required verification and the mandatory final audit pass before handoff.
  - Use a scoped commit helper at the end if repo files change.

## Risks and mitigations

1. Risk: The patch overlaps package metadata already modified by the package-architecture hard-cut lane.
   Mitigation: Apply on top of current files, then inspect the resulting diff on package manifests before verification.
2. Risk: Import rewrites could expose missing exports or typecheck gaps across assistant-engine and vault-inbox.
   Mitigation: Run required verification and inspect guard/test fallout before final review.

## Tasks

1. Register the lane in the coordination ledger and capture scope/risks here.
2. Land the supplied patch on top of the current worktree.
3. Review the resulting diff for overlap with existing package metadata changes and fix any fallout.
4. Run required verification for the touched package/runtime surface.
5. Run the mandatory final audit review, address findings, and finish with a scoped commit.

## Decisions

- Use a plan-bearing supplied-patch workflow because the patch is broad and overlaps an already-dirty package-metadata lane.
- Prefer landing the supplied patch directly, then reconciling overlaps, because `git apply --check` succeeded cleanly against the current tree.
- Keep the new assistant-engine and vault-inbox internal-subpath boundary guard focused on non-test workspace code so repo tests can continue asserting package internals without forcing new public entrypoints for test-only use.
- Restore the assistant-engine root re-export of `assistant-cli-contracts` so existing root-package consumers keep their type surface after the wrapper cleanup.

## Verification

- Commands to run:
  - `pnpm typecheck`
  - `pnpm test:coverage`
- Expected outcomes:
  - The repo package/runtime acceptance lane for this surface passes, or any unrelated blocker is called out with evidence.

## Outcomes

- Landed the supplied assistant-engine and vault-inbox boundary cleanup patch plus two current-tree follow-ups:
  - moved lingering CLI tests from `@murphai/vault-inbox/inbox-cli-contracts` to `@murphai/operator-config/inbox-cli-contracts`
  - restored the assistant-engine root re-export of `assistant-cli-contracts`
- `pnpm typecheck`:
  - boundary checks passed
  - touched packages including `assistant-engine`, `vault-inbox`, `assistant-runtime`, `assistantd`, `setup-cli`, and `assistant-cli` typechecked successfully
  - command failed later on an unrelated dirty-tree file: `packages/cli/test/release-script-coverage-audit.test.ts` references `bundleDependencies` on a narrowed local package-json test type from the separate package-architecture lane
- `pnpm test:coverage`:
  - completed repo boundary/doc/runtime/test execution with `84` files and `1389` tests passing
  - command failed only on pre-existing branch coverage thresholds in `packages/core/src/vault-metadata.ts` and `packages/core/src/vault-upgrade.ts`, outside this change surface
- Focused direct proof:
  - `pnpm --dir packages/cli exec vitest run --config vitest.config.ts test/setup-cli.test.ts test/inbox-model-route.test.ts` passed with `2` files and `70` tests
Completed: 2026-04-06
