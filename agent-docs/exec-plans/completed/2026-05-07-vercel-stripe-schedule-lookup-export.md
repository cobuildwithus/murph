# Fix hosted Stripe schedule lookup exports

Status: completed
Created: 2026-05-07
Updated: 2026-05-07

## Goal

- Restore the hosted web production build by making the hosted Stripe
  subscription schedule blind-index helpers available from the
  hosted-onboarding contact privacy barrel used by billing storage code.

## Success criteria

- `apps/web/src/lib/hosted-onboarding/hosted-member-billing-store.ts` can import
  the schedule lookup helpers from `./contact-privacy`.
- Focused hosted onboarding tests cover the schedule lookup helper export.
- Focused build/typecheck verification passes or any unrelated blocker is
  documented with exact command evidence.

## Scope

- In scope:
  - Hosted Stripe subscription schedule blind-index helper exports.
  - Narrow hosted onboarding regression coverage.
- Out of scope:
  - Stripe schedule business logic changes.
  - Billing schema or migration changes.
  - UI copy or plan-switch behavior changes.

## Constraints

- Technical constraints:
  - Preserve existing blind-index key derivation semantics and keyring rotation
    candidate behavior.
  - Do not expose raw Stripe identifiers in tests, logs, docs, or generated
    output.
- Product/process constraints:
  - Keep the change scoped around the Vercel build failure and avoid unrelated
    active worktree lanes.

## Risks and mitigations

1. Risk: The barrel export compiles but the underlying blind-index kind is not
   included in the core type.
   Mitigation: Include the core kind/helper and a public-barrel test assertion.
2. Risk: The scoped commit accidentally captures unrelated dirty hosted-web
   work.
   Mitigation: Finish through the repo scoped commit helper with explicit file
   paths only.

## Tasks

1. Confirm the missing export path and existing local dirty state.
2. Add/verify hosted Stripe subscription schedule lookup helper exports.
3. Add focused test coverage for the public contact privacy barrel.
4. Run focused verification and inspect the scoped diff for leakage.
5. Close the active plan with a scoped commit if the worktree allows it.

## Decisions

- Treat this as a narrow build-regression fix, not a redesign of hosted billing
  schedule reconciliation.

## Verification

- Commands to run:
  - `pnpm --dir apps/web exec vitest run test/contact-privacy-member-lookups.test.ts`
  - `pnpm --dir apps/web exec tsc --noEmit --project tsconfig.json`
  - `pnpm --dir apps/web build`
- Expected outcomes:
  - The contact privacy regression test passes.
  - Hosted web type/build no longer fail on missing schedule lookup exports.
Completed: 2026-05-07
