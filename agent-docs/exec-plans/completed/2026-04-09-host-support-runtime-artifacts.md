# Restore host-support CLI runtime artifacts

Status: completed
Created: 2026-04-09
Updated: 2026-04-09

## Goal

- Make the GitHub `Murph Host Support` workflow follow the real built CLI runtime-artifact contract for its setup/inbox integration tests, so the host matrix stops failing on stale missing-artifact expectations.

## Success criteria

- `.github/workflows/host-support.yml` builds the prepared CLI runtime artifacts before invoking the built-runtime CLI tests.
- The host-support workflow guard test encodes that contract.
- Local verification reproduces the host-support command path successfully.

## Scope

- In scope:
  - Host-support workflow steps for the CLI matrix job.
  - The CLI helper's required built-artifact list when it has drifted from `pnpm build:test-runtime:prepared`.
  - The matching workflow guard test.
  - Durable CI-map text that describes the workflow's current behavior.
- Out of scope:
  - Broader CLI runtime-artifact refactors.
  - Release workflow changes unless required by the host-support fix.
  - Unrelated CLI test failures outside the host-support built-runtime artifact gap.

## Constraints

- Preserve unrelated worktree edits and ledger rows.
- Keep the fix aligned with the existing repo CLI verification contract instead of adding a one-off workaround.
- Verify the same command shape GitHub runs for the failing job.

## Risks and mitigations

1. Risk:
   The workflow could still miss the environment flag the built-runtime tests use to skip redundant artifact rebuild attempts.
   Mitigation:
   Mirror the repo's existing `run_verify_cli` contract by pairing `pnpm build:test-runtime:prepared` with `MURPH_PREPARED_CLI_RUNTIME_ARTIFACTS=1`.

2. Risk:
   The helper and builder could still disagree about which built artifacts are required, leaving CI red even after the workflow fix.
   Mitigation:
   Align the helper's required artifact list to the artifacts that `pnpm build:test-runtime:prepared` explicitly proves, then rerun the exact host-support lane.

## Tasks

1. Reproduce the host-support CLI matrix failure locally.
2. Patch the workflow to prepare built runtime artifacts before the CLI suite.
3. Align the CLI helper's required artifact list with the prepared-runtime build contract and update the host-support guard / CI-map text.
4. Re-run the exact host-support command path locally, then review and commit.

## Decisions

- Follow the existing repo CLI verification contract from `scripts/workspace-verify.sh` rather than inventing a host-support-only variant.
- Keep the host-support suite on built-runtime CLI tests instead of narrowing it to source-mode tests.
- Treat `scripts/build-test-runtime-prepared.mjs` as the source of truth for the prepared built-runtime artifact set; remove stale helper-only requirements instead of forcing unrelated dead artifacts back into the build.

## Verification

- Commands to run:
  - `pnpm build:test-runtime:prepared`
  - `MURPH_PREPARED_CLI_RUNTIME_ARTIFACTS=1 pnpm exec vitest run packages/cli/test/setup-cli.test.ts packages/cli/test/inbox-cli.test.ts --no-coverage --maxWorkers 1`
  - `pnpm exec vitest run packages/cli/test/host-support-workflow-guards.test.ts --no-coverage`
  - `pnpm typecheck`
- Expected outcomes:
  - All commands pass on the final tree.
Completed: 2026-04-09
