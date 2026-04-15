# Architecture Review Wake Patch

Status: completed

## Goal

Land the returned ChatGPT architecture-review patch for the hosted Stripe billing seam so billing-only flows depend on a narrow hosted-member billing snapshot instead of the full member snapshot.

## Success criteria

- The returned patch applies cleanly or is adapted minimally for the current repo state.
- Changes stay limited to the hosted-onboarding billing slice in `apps/web` plus the smallest applicable test coverage updates from the artifact.
- Required verification runs for the touched owner and any unrelated blockers are documented clearly.
- Required completion-workflow audit passes run before handoff.

## Scope

- `apps/web/src/lib/hosted-onboarding/hosted-member-store.ts`
- `apps/web/src/lib/hosted-onboarding/stripe-billing-lookup.ts`
- `apps/web/src/lib/hosted-onboarding/stripe-billing-policy.ts`
- `apps/web/src/lib/hosted-onboarding/member-activation.ts`
- `apps/web/test/hosted-onboarding-billing-seam.test.ts`
- Coordination and commit artifacts required by repo workflow

## Constraints

- Treat the returned patch as behavioral intent, not overwrite authority.
- Keep the change scoped to the downloaded artifact.
- Preserve unrelated worktree edits, including overlapping hosted-onboarding wake work already in progress.
- Do not add dependency changes.

## Tasks

1. Confirm the exported thread and downloaded patch still match the current repo state.
2. Apply the narrow hosted-member billing snapshot refactor and review the resulting diff for current-state fit.
3. Run the required scoped verification for the touched owner.
4. Run required completion-workflow audit passes, then finish with a scoped commit.

## Risks and mitigations

- `member-activation.ts` already has unrelated in-flight edits.
  Mitigation: limit that file to the artifact's signature narrowing and preserve all existing behavior changes.
- The artifact includes a `setup-env` addition that is already present locally.
  Mitigation: skip non-applicable hunks rather than forcing redundant edits.

## Verification

- Planned: `pnpm typecheck`
- Planned: `pnpm test:diff apps/web/src/lib/hosted-onboarding/hosted-member-store.ts apps/web/src/lib/hosted-onboarding/stripe-billing-lookup.ts apps/web/src/lib/hosted-onboarding/stripe-billing-policy.ts apps/web/src/lib/hosted-onboarding/member-activation.ts apps/web/test/hosted-onboarding-billing-seam.test.ts`
- Planned: required completion-workflow audit passes (`coverage-write`, `task-finish-review`)
Updated: 2026-04-15
Completed: 2026-04-15
