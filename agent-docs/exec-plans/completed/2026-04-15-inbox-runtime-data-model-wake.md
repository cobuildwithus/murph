# Inbox Runtime Data Model Wake Patch

Status: completed

## Goal

Land the returned ChatGPT patch for inbox runtime type ownership so `inbox-services` reuses the canonical `@murphai/inboxd` models and drops dead optional runtime branches.

## Success criteria

- The exported thread summary and downloaded patch match the current repo state closely enough to apply with only minimal adaptation.
- Changes stay limited to the `packages/inbox-services/**` slice required by the artifact plus coordination and commit workflow files.
- Required verification runs for the touched owner and any unrelated blockers are documented clearly.
- Required completion-workflow audit passes run before handoff.

## Scope

- `packages/inbox-services/src/inbox-app/types.ts`
- `packages/inbox-services/src/inbox-app/runtime.ts`
- `packages/inbox-services/src/inbox-app/reads.ts`
- `packages/inbox-services/src/inbox-services/parser.ts`
- `packages/inbox-services/src/inbox-services/shared.ts`
- `packages/inbox-services/test/runtime-type-ownership.test.ts`
- Coordination and commit artifacts required by repo workflow

## Constraints

- Treat the returned patch as behavioral intent, not overwrite authority.
- Keep the change scoped to the downloaded artifact.
- Preserve unrelated worktree edits.
- Do not add dependency changes.

## Tasks

1. Confirm the exported thread and downloaded patch still fit the current inbox-services and inboxd code.
2. Apply the narrow inbox runtime ownership cleanup and add the owner-seam test.
3. Run the required scoped verification for the touched owner.
4. Run required completion-workflow audit passes, then finish with a scoped commit.

## Risks and mitigations

- The patch may assume slightly older local code.
  Mitigation: adapt only what is needed for the current runtime and type surfaces.
- The worktree already contains unrelated active edits.
  Mitigation: touch only the artifact files and commit only the exact touched paths.

## Verification

- Planned: `pnpm typecheck`
- Planned: `bash scripts/workspace-verify.sh test:diff packages/inbox-services/src/inbox-app/types.ts packages/inbox-services/src/inbox-app/runtime.ts packages/inbox-services/src/inbox-app/reads.ts packages/inbox-services/src/inbox-services/parser.ts packages/inbox-services/src/inbox-services/shared.ts packages/inbox-services/test/runtime-type-ownership.test.ts`
- Planned: required completion-workflow audit passes (`coverage-write`, `task-finish-review`)
Updated: 2026-04-15
Completed: 2026-04-15
