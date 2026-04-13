# Hosted Onboarding Boot State

## Goal

Make hosted onboarding treat paid users as ready once billing access is active, while still telling them when Murph is finishing background Cloudflare boot and first-contact work.

## Scope

- Simplify hosted onboarding stage derivation so background activation work is not the primary user-facing stage.
- Expose a separate boot/pending signal to the join and success UIs.
- Tighten hosted onboarding status polling so slow control-plane reads fail fast.
- Update focused tests for hosted onboarding stage transitions and copy.

## Constraints

- Preserve unrelated dirty worktree edits.
- Keep Stripe webhook reconciliation and execution outbox ownership intact.
- Avoid introducing new dependencies or speculative persistence.

## Verification

- Run truthful `apps/web`-scoped verification for touched code.
- Add or update targeted tests covering the new readiness/booting behavior.

## Notes

- The existing flow blocks user readiness on the `member.activated` background event, which makes paid users wait on Cloudflare boot/welcome delivery instead of entitlement.
Status: completed
Updated: 2026-04-13
Completed: 2026-04-13
