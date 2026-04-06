# Hosted-member privacy Batch 1 proof and docs

Status: completed
Created: 2026-04-06
Updated: 2026-04-06

## Goal

- Record direct live-tree proof for the Batch 1 hosted-member privacy cutover assumptions without changing runtime behavior.
- Lock the current four-lane ownership split in a concise note: entitlement on `HostedMember`, identity on `HostedMemberIdentity`, routing on `HostedMemberRouting`, and billing refs on `HostedMemberBillingRef`.

## Success criteria

- A concise proof note exists under `docs/reviews/` and clearly separates locked facts from proof-required gaps.
- The note records direct proof that verified email currently stays in hosted execution user env / Cloudflare route state rather than a Postgres account field.
- The note records direct proof that RevNet is environment-gated and should not make wallet mandatory when disabled.
- The note records that `HostedSession` runtime usage is still unproven and must remain proof-required before removal.
- Any added tests stay narrowly focused on stable proof and do not redesign the schema or widen runtime behavior.

## Scope

- In scope:
  - durable proof note under `docs/reviews/**`
  - optional narrow clarification in `ARCHITECTURE.md` if the live architecture needs a short durable statement
  - optional focused hosted-web proof tests under `apps/web/test/**`
- Out of scope:
  - Prisma schema redesign
  - auth/onboarding cutover
  - routing cutover
  - Stripe billing-ref cutover
  - removing `HostedSession`
  - adding email identity fields to Postgres

## Constraints

- Preserve unrelated dirty worktree edits.
- Prefer direct proof and concise docs over runtime refactors.
- Mark anything not fully proven from the live tree as `UNCONFIRMED`.
- Keep email documented as out-of-Postgres state.

## Risks and mitigations

1. Risk: The note drifts into migration intent instead of current-tree proof.
   Mitigation: Cite only current files, current tests, and direct search results from the live repo.
2. Risk: A proof test accidentally locks temporary wide-row behavior that later batches must change.
   Mitigation: Add tests only for stable assumptions such as email env storage or RevNet gating, not for temporary cutover heuristics.
3. Risk: Shared-worktree overlap in hosted-web tests creates merge friction.
   Mitigation: Keep any test addition focused to one file and preserve adjacent edits.

## Tasks

1. Gather direct proof for the email env boundary, RevNet gating, `HostedSession` references, and current `HostedMember` coupling.
2. Write the concise proof note with locked assumptions versus proof-required gaps.
3. Add a minimal focused test only if it materially locks a stable assumption that is not already covered.
4. Run the required verification for the touched surface, then run the required final audit review.

## Verification

- Planned commands:
  - `pnpm typecheck`
  - `pnpm test:coverage`
  - `pnpm --dir apps/web lint`
- Planned direct proof:
  - direct search for non-test `HostedSession` references
  - direct code readback for verified-email env sync and RevNet gating
Completed: 2026-04-06
