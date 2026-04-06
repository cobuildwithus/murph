# Speed up low-risk repo verification workflow

Status: completed
Created: 2026-04-06
Updated: 2026-04-06

## Goal

- Reduce the fixed overhead for tiny repo-internal changes by making low-risk verification cheaper, disabling default retries that waste time on deterministic failures, adding per-phase timing telemetry, and documenting the smaller fast path clearly in the existing workflow docs.

## Success criteria

- `scripts/workspace-verify.sh` defaults to zero retries, prints per-phase timing, and skips the heavy app verify tail for a narrow low-risk repo-internal fast path.
- The verification docs define that same low-risk fast path without adding broad new command surfaces.
- The completion workflow relaxes mandatory audit-subagent use for tiny repo-internal workflow/tooling changes while preserving the stricter path for normal repo code.
- Required verification is run, and any unrelated repo-wide failures are documented precisely.

## Scope

- In scope:
  - `scripts/workspace-verify.sh`
  - `agent-docs/operations/verification-and-runtime.md`
  - `agent-docs/operations/completion-workflow.md`
  - `agent-docs/operations/agent-workflow-routing.md`
  - `agent-docs/references/testing-ci-map.md`
- Out of scope:
  - Changing app/package runtime behavior
  - Adding new root package scripts for this fast path
  - Touching the unrelated hosted-runtime work already active in the tree

## Constraints

- Technical constraints:
  - Keep the fast path narrow and easy to reason about.
  - Prefer deleting or simplifying existing behavior over adding more knobs.
- Product/process constraints:
  - Preserve the normal verification baseline for ordinary repo code changes.
  - Keep commit scope isolated from unrelated dirty worktree edits.

## Risks and mitigations

1. Risk: A fast-path skip could suppress app verification for changes that really do affect app behavior.
   Mitigation: Keep the auto-skip predicate intentionally narrow and limited to repo-internal docs/process/verification-tooling paths.
2. Risk: Reducing retries could make flaky commands fail faster in CI or on slower machines.
   Mitigation: Keep an explicit env override for retry count instead of removing the capability entirely.
3. Risk: Workflow docs could drift from the actual script behavior.
   Mitigation: Update the verification map and workflow-routing docs in the same patch.

## Tasks

1. Add the narrow low-risk fast-path and timing telemetry to `scripts/workspace-verify.sh`.
2. Update verification docs to define the smaller fast path and the new retry/timing behavior.
3. Relax mandatory audit use for tiny repo-internal workflow/tooling changes in the completion docs.
4. Run required verification, record any unrelated red lanes, and commit only the scoped files.

## Decisions

- Keep the fast path automatic but intentionally narrow rather than introducing another root package script.
- Keep retries available only through an explicit env override.

## Verification

- Commands to run:
  - `bash -n scripts/workspace-verify.sh`
  - `pnpm typecheck`
  - `pnpm test`
  - `pnpm test:coverage`
- Expected outcomes:
  - Script syntax passes.
  - `pnpm typecheck` passes.
  - `pnpm test` / `pnpm test:coverage` either pass or fail only in credibly unrelated pre-existing/app-active lanes, with the failing targets called out explicitly.
- Outcomes:
  - `bash -n scripts/workspace-verify.sh`: passed.
  - `pnpm typecheck`: passed, with the new per-step timing output visible in the root verify harness.
  - `pnpm test`: passed on the final state, including the heavier app verify lane.
  - `pnpm test:coverage`: currently fails in the pre-existing dirty-tree runtime build lane during `build:test-runtime:prepared`, with TypeScript export/path errors in runtime-state consumers such as `packages/device-syncd`, `packages/inboxd`, `packages/query`, `packages/assistant-core`, and `packages/gateway-local`.
  - Direct focused proof: a simulated tooling-only changed-file set made `should_skip_app_verification` return `SKIP`, showing that the narrow repo-internal fast path suppresses the app verify tail only for that path set.
Completed: 2026-04-06
