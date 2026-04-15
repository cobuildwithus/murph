# Giant-file composability wake patch

Status: completed

## Goal

Land the returned ChatGPT patch for the giant-file composability review, keeping only the concrete seam extractions and documentation captured in the downloaded artifact.

## Success criteria

- The returned patch is applied or minimally adapted for current repo state.
- Changes stay scoped to the artifact's Cloudflare usage-store split, hosted RevNet reconciliation split, and seam-review documentation.
- Required verification runs for the touched owners and any unrelated blockers are documented clearly.
- Required completion-workflow audit passes run before handoff.

## Scope

- `agent-docs/index.md`
- `agent-docs/references/giant-file-composability-seams.md`
- `apps/cloudflare/src/runner-outbound.ts`
- `apps/cloudflare/src/usage-store.ts`
- `apps/cloudflare/src/usage-store/dirty-users.ts`
- `apps/cloudflare/src/user-runner.ts`
- `apps/cloudflare/src/worker-routes/internal-user.ts`
- `apps/web/app/api/internal/hosted-onboarding/stripe/cron/route.ts`
- `apps/web/src/lib/hosted-onboarding/stripe-event-reconciliation.ts`
- `apps/web/src/lib/hosted-onboarding/stripe-revnet-reconciliation.ts`
- Coordination and commit artifacts required by repo workflow

## Constraints

- Treat the returned patch as behavioral intent, not overwrite authority.
- Keep the change scoped to the downloaded artifact.
- Preserve unrelated worktree edits, especially overlapping active wake-task slices.
- Do not add dependency changes.

## Tasks

1. Confirm the exported thread and downloaded patch still match the current repo state.
2. Apply the composability seam extractions and docs with only the minimum current-state adaptations.
3. Run the required verification lane for the touched app slices.
4. Run required completion-workflow audit passes, then finish with a scoped commit.

## Risks and mitigations

- `apps/cloudflare/src/usage-store.ts` and `apps/cloudflare/src/worker-routes/internal-user.ts` already have overlapping local edits from another active wake task.
  Mitigation: merge only the artifact-specific extraction changes and avoid disturbing the unrelated simplification diff.
- The patch spans both `apps/cloudflare` and `apps/web`, so owner verification must still be coverage-bearing.
  Mitigation: use truthful `test:diff` coverage if available; otherwise fall back to the required owner-level verification lane.

## Verification

- Planned: `pnpm typecheck`
- Planned: `bash scripts/workspace-verify.sh test:diff apps/cloudflare/src/runner-outbound.ts apps/cloudflare/src/usage-store.ts apps/cloudflare/src/usage-store/dirty-users.ts apps/cloudflare/src/user-runner.ts apps/cloudflare/src/worker-routes/internal-user.ts apps/web/app/api/internal/hosted-onboarding/stripe/cron/route.ts apps/web/src/lib/hosted-onboarding/stripe-event-reconciliation.ts apps/web/src/lib/hosted-onboarding/stripe-revnet-reconciliation.ts`
- Planned: required completion-workflow audit passes (`coverage-write`, `task-finish-review`)
Updated: 2026-04-15
Completed: 2026-04-15
