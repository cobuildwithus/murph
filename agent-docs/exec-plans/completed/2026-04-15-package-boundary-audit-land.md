# Package-boundary audit patch landing

Status: completed

## Goal

Land the supplied package-boundary audit patch by rebasing its small boundary-tightening changes onto the current Murph tree.

## Success criteria

- The intended boundary changes from the supplied patch are present in the current repo state.
- Existing unrelated worktree edits remain untouched.
- Required verification runs for the touched owners and boundary guard.
- Required completion-workflow audit passes run before handoff.

## Scope

- `apps/cloudflare/src/web-callback-auth.ts`
- `apps/web/src/lib/hosted-execution/cloudflare-callback-auth.ts`
- `packages/inbox-services/src/inbox-app/types.ts`
- `packages/inboxd/src/runtime.ts`
- `packages/cloudflare-hosted-control/package.json`
- `scripts/verify-workspace-boundaries.mjs`
- Coordination/commit artifacts required by repo workflow

## Constraints

- Treat the supplied patch as behavioral intent, not overwrite authority.
- Preserve unrelated worktree edits in the dirty tree.
- Keep the landing scoped to the boundary-tightening changes described by the patch.
- Do not add dependency changes.

## Tasks

1. Inspect the target files and adapt the patch where repo drift prevents a clean apply.
2. Verify the resulting diff stays limited to the intended boundary changes.
3. Run the required verification lane for the touched owners and boundary guard.
4. Run required completion-workflow audit passes, then finish with a scoped commit.

## Risks and mitigations

- `apps/web` already has active unrelated edits in flight.
  Mitigation: touch only the callback-auth file from this patch and preserve the other lane's changes.
- The supplied patch already drifted at least one hunk.
  Mitigation: rebase file-by-file against current sources instead of forcing `git apply`.
- Boundary guards can become stale if the intended imports shifted.
  Mitigation: inspect the current imports before editing and keep the guard aligned with the landed code.

## Verification

- Planned: `pnpm typecheck`
- Planned: `pnpm test:diff apps/cloudflare apps/web packages/inbox-services packages/inboxd packages/cloudflare-hosted-control`
- Planned: `node scripts/verify-workspace-boundaries.mjs`
- Planned: required completion-workflow audit passes (`coverage-write`, `task-finish-review`)
Updated: 2026-04-15
Completed: 2026-04-15
