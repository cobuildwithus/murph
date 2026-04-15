# Cloudflare simplification wake patch

Status: completed

## Goal

Land the returned ChatGPT simplification patch for a narrow `apps/cloudflare` slice without changing runtime behavior.

## Success criteria

- The returned patch applies cleanly or is adapted minimally for current repo state.
- Changes stay limited to the three Cloudflare files named in the downloaded artifact.
- Required verification runs for the touched owner and any unrelated blockers are documented clearly.
- Required completion-workflow audit passes run before handoff.

## Scope

- `apps/cloudflare/src/runner-outbound/business-outcomes.ts`
- `apps/cloudflare/src/usage-store.ts`
- `apps/cloudflare/src/worker-routes/internal-user.ts`
- Coordination and commit artifacts required by repo workflow

## Constraints

- Treat the returned patch as behavioral intent, not overwrite authority.
- Keep the change scoped to the downloaded artifact.
- Preserve unrelated worktree edits.
- Do not add dependency changes.

## Tasks

1. Confirm the exported thread and downloaded patch still match the current repo state.
2. Apply the narrow Cloudflare simplifications and review the resulting diff for current-state fit.
3. Run the required Cloudflare verification lane.
4. Run required completion-workflow audit passes, then finish with a scoped commit.

## Risks and mitigations

- The patch may assume slightly older local code.
  Mitigation: adapt only what is needed for a clean behavioral match.
- The dirty worktree already contains unrelated hosted-web edits.
  Mitigation: scope verification to the current Cloudflare paths and commit only touched files.

## Verification

- Planned: `bash scripts/workspace-verify.sh test:diff apps/cloudflare/src/runner-outbound/business-outcomes.ts apps/cloudflare/src/usage-store.ts apps/cloudflare/src/worker-routes/internal-user.ts`
- Planned: required completion-workflow audit passes (`coverage-write`, `task-finish-review`)
Updated: 2026-04-15
Completed: 2026-04-15
