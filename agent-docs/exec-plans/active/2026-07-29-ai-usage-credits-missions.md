# Show AI usage credits and referral missions in Settings

Status: active
Created: 2026-07-29
Updated: 2026-07-29

## Goal

- Give signed-in members one honest Settings view of usage-credit activity and
  the referral missions they have armed or earned, derived from the existing
  web-owned billing and referral records.
- Keep this surface read-only: it must not create billing state, expose private
  participant identity, or become a second accounting or referral owner.

## Success criteria

- Settings shows bounded, newest-first purchase activity with clear source,
  original added amount, and date while leaving remaining capacity in the
  existing combined usage bar.
- Settings shows the member's current referral mission state without exposing
  server-only qualification counters or another person's identity.
- The production component is represented in the design catalog with inert
  synthetic data, and desktop/mobile proof matches the production design
  system.
- Focused unit/component coverage, canonical diff verification, product and
  frontend review, CI, and the final ReviewGPT gate pass on the exact PR head.
- The PR merges cleanly and the task worktree is retired.

## Scope

- In scope: a member-bound read projection, reusable Settings presentation,
  current Settings integration, design-catalog studies, focused tests, and the
  live usage-referral product contract.
- Out of scope: new credit or referral writes, schema changes, Stripe calls,
  referral policy changes, qualification counters, provider/runtime changes,
  and any new persistence or background process.

## Constraints

- Technical constraints: reuse the append-only usage-credit ledger and
  `HostedUsageReferral` as the sole durable owners; use bounded member-scoped
  reads; keep client props minimal and serializable; preserve current
  server-component ownership and independent fetch parallelism.
- Product/process constraints: present one calm, legible account-management
  surface rather than gamification; preserve the existing Settings visual
  language; never expose participant identifiers, raw routing evidence, or
  server-only abuse controls; adapt the supplied patch to current `origin/main`
  instead of treating it as overwrite authority.

## Risks and mitigations

1. Risk: A new projection drifts from accounting truth or re-exposes an exact
   usage-credit balance.
   Mitigation: derive purchase rows only from immutable grant entries, never
   read mutable remaining-capacity projections, document the ownership
   boundary, and test the bounded response shape and empty state.
2. Risk: Referral presentation leaks another person's identity or qualification
   evidence.
   Mitigation: return only policy/status/reward/timestamps already safe for the
   authenticated referrer and cover that exact response shape.
3. Risk: The large supplied diff duplicates current Settings or usage work.
   Mitigation: inspect current owners and existing design studies, preserve
   overlapping work, and delete redundant presentation or data flow.

## Tasks

1. Review the supplied diff against current billing, referral, Settings, and
   design-catalog owners.
2. Implement the smallest bounded read projection and reusable presentation.
3. Add focused data and component coverage plus durable contract updates.
4. Run focused tests, canonical diff verification, and desktop/mobile browser
   proof.
5. Resolve product-experience and preliminary ReviewGPT findings, then complete
   parent review and the final ReviewGPT/CI gate on the exact pushed head.
6. Merge the accepted PR and retire the clean task worktree.

## Decisions

- The live repository intentionally removed the coordination ledger; this plan,
  worktree, branch, and PR are the coordination surfaces.
- The supplied patch is behavioral intent. Current `origin/main`, durable
  contracts, and existing source owners control the final implementation.
- The supplied per-grant remaining-dollar column conflicts with the live
  hidden-balance contract. Purchase history keeps only immutable source,
  original amount, and date; current capacity remains in the combined AI usage
  bar.
- The required product review found that the first integration separated the
  usage bar from its detail with plan-selection cards on mobile. The billing
  layout now owns one explicit detail slot immediately after the bar and before
  plan choices.
- An armed mission has already been selected. The member-facing state is
  therefore "Waiting for a new group," and its durable `armedAt` date is
  presented as "Selected," not as an unstarted or merely ready state.
- Historical activity must remain truthful when new missions or current usage
  are unavailable. Disabled mission history does not invite a new mission, and
  purchase rows say that amounts are original additions rather than assuming a
  current usage bar is present.
- The Murph handoff asks a neutral question about available missions. Opening
  the handoff does not arm a mission; the existing exact policy selection
  remains the consent boundary.

## Verification

- Focused hosted-web Vitest for the read projection, referral policy, Settings
  page, and component.
- `pnpm test:diff` across the exact touched paths.
- Authenticated design-catalog desktop and mobile screenshots plus frontend
  design-proof validation.
- Preliminary `completion-specialists`, required product-experience review,
  Claude Code UI double-check, parent final review, final ReviewGPT, required
  GitHub Actions, and non-mutating mergeability proof.

Current evidence:

- Focused hosted-web Vitest: 88 tests passed across the activity projection,
  billing layout, referral policy, and Settings integration.
- Hosted-web prepared typecheck, touched-file ESLint, and `git diff --check`
  passed.
- Desktop and mobile browser proof covered the production ordering study,
  production-composed history without a current usage bar, and enabled,
  selected/waiting, and disabled-new-missions history states. Every captured
  study had equal client and scroll widths and retained semantic table labels.
- The optional Claude Code UI double-check was attempted once and stopped after
  the configured reviewer reported exhausted usage credits, as required by the
  review workflow.
