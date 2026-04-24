# Host Support CI Speedup

Status: completed
Created: 2026-04-24
Updated: 2026-04-24
Completed: 2026-04-24

## Goal

- Reduce the `Murph Host Support` workflow wall time for the release-check portion by roughly 3x without dropping the release validation, clean build, typecheck, package coverage, app verification, or fixture coverage surfaces.

## Success Criteria

- The host-support release gate no longer runs the full `pnpm release:check` monolith as one long job.
- Release metadata/build/typecheck, package coverage shards, app verification, and fixture coverage can run as separate GitHub jobs.
- Workflow guard tests and durable CI docs describe the new scheduling.
- Focused verification for workflow/docs/test changes passes, or any unrelated blocker is recorded.

## Scope

- In scope:
  - `.github/workflows/host-support.yml`
  - Direct workflow guard tests under `packages/cli/test/**`
  - CI verification docs under `agent-docs/**`
- Out of scope:
  - Runtime package behavior
  - Test coverage thresholds
  - Dependency changes

## Constraints

- Preserve unrelated dirty-tree work and existing active ledger rows.
- Do not weaken the release gate; split scheduling only.
- Keep deterministic hosted-web placeholder envs for CI app verification.

## Risks And Mitigations

1. Risk: A split workflow can accidentally omit a check covered by `pnpm release:check`.
   Mitigation: Mirror the release script components explicitly and add guard-test assertions for the split jobs.
2. Risk: Package coverage shards can drift from the package list in `scripts/workspace-verify.sh`.
   Mitigation: Keep shards explicit in the workflow guard test so drift is caught during CLI tests.

## Tasks

1. Patch host-support workflow release checks into parallel jobs.
2. Update guard tests and durable docs.
3. Run focused verification.
4. Review the scoped diff and close the plan.

## Verification

- `ruby -e "require 'yaml'; YAML.load_file('.github/workflows/host-support.yml'); puts 'host-support workflow YAML parsed'"` passed.
- `git diff --check -- .github/workflows/host-support.yml packages/cli/test/host-support-workflow-guards.test.ts agent-docs/operations/verification-and-runtime.md agent-docs/references/testing-ci-map.md agent-docs/exec-plans/active/2026-04-24-host-support-ci-speedup.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md` passed.
- `pnpm exec vitest run --config packages/cli/vitest.workspace.ts packages/cli/test/host-support-workflow-guards.test.ts --no-coverage` passed.
- `pnpm typecheck` passed.
- `bash scripts/workspace-verify.sh test:diff .github/workflows/host-support.yml packages/cli/test/host-support-workflow-guards.test.ts agent-docs/operations/verification-and-runtime.md agent-docs/references/testing-ci-map.md agent-docs/exec-plans/active/2026-04-24-host-support-ci-speedup.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md` passed, including the `packages/cli` owner typecheck and source test lane.
