# Greenfield Legacy Removal Wake Patch

Status: completed

## Goal

Land the returned ChatGPT wake patch that hard-cuts two greenfield-only compatibility paths: deprecated assistant session secret sidecar parsing and local hosted env value normalization.

## Success criteria

- The returned patch is applied or adapted minimally for the current repo state.
- Changes stay limited to the artifact-backed operator-config and local hosted dev env files.
- Required verification runs for the touched owners and any unrelated blockers are documented clearly.
- Required completion-workflow audit passes run before handoff.

## Scope

- `packages/assistant-cli/test/assistant-doctor-security.test.ts`
- `packages/operator-config/src/assistant-cli-contracts.ts`
- `packages/operator-config/test/assistant-cli-contracts.test.ts`
- `scripts/dev-hosted-local/environment.ts`
- `scripts/dev-hosted-local/environment.test.ts`
- Coordination and commit artifacts required by repo workflow

## Constraints

- Treat the returned patch as behavioral intent, not overwrite authority.
- Preserve unrelated worktree edits, especially the already-active operator-config wake work.
- Keep the change scoped to the downloaded artifact.
- Do not add dependency changes.

## Tasks

1. Confirm the exported thread and downloaded patch still match the current repo state.
2. Apply the narrow legacy-removal edits without disturbing overlapping in-flight operator-config work.
3. Update any directly affected downstream owner tests if the hard cut changes current fail-fast behavior.
4. Run the required scoped verification for the touched owners.
5. Run required completion-workflow audit passes, then finish with a scoped commit.

## Risks and mitigations

- `packages/operator-config/src/assistant-cli-contracts.ts` already has an overlapping active wake task.
  Mitigation: land only the artifact-backed schema hard-cut and preserve the other in-flight edits untouched.
- The patch removes compatibility behavior that could still be hiding stale local files.
  Mitigation: keep the scope narrow, update the tests, and report the explicit fail-fast consequence in handoff.

## Verification

- Planned: `pnpm typecheck`
- Planned: `bash scripts/workspace-verify.sh test:diff packages/assistant-cli/test/assistant-doctor-security.test.ts packages/operator-config/src/assistant-cli-contracts.ts packages/operator-config/test/assistant-cli-contracts.test.ts scripts/dev-hosted-local/environment.ts scripts/dev-hosted-local/environment.test.ts`
- Planned: required completion-workflow audit passes (`coverage-write`, `task-finish-review`)
Updated: 2026-04-15
Completed: 2026-04-15
