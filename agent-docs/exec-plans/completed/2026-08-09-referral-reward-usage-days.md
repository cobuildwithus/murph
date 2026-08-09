# Referral reward usage-day labels

Status: completed
Created: 2026-08-09
Updated: 2026-08-09

## Goal

- Present referral rewards as days of Murph usage instead of dollar amounts
  across public marketing, Settings receipts, runtime tools, and completion
  notices while leaving internal credit accounting unchanged.

## Success criteria

- The current fixed referral offers display as about 10 and 14 days of Murph
  usage on every user-facing surface.
- Historical receipts derive their label from the persisted grant and the
  receipt's policy basis instead of current offer constants.
- Copy states that usage days are an estimate of capacity and do not extend a
  trial or subscription period.
- Focused tests, web typecheck, ReviewGPT gates, and exact-head CI pass.

## Scope

- In scope: referral reward projection, public referral copy, Settings history,
  runtime tool snapshots, completion notices, focused coverage, and the active
  product contract.
- Out of scope: ledger units, grant amounts, billing plans, top-up labels,
  qualification, caps, scheduling, and deployment architecture.

## Constraints

- Technical constraints: retain USD-micro accounting and derive presentation
  from existing persisted receipt facts without adding state.
- Product/process constraints: preserve eligibility and privacy wording, use the
  worktree/PR lane, and merge only after green exact-head gates.

## Risks and mitigations

1. Risk: "days" could be mistaken for extending calendar access.
   Mitigation: say "days of Murph usage" and explicitly separate capacity from
   trial or subscription duration.
2. Risk: current policy values could rewrite historical receipt labels or equal
   grants could appear unequal across referral paths.
   Mitigation: let the persisted policy version select one shared, versioned
   amount-to-days generation, then derive solely from the persisted grant.

## Tasks

1. Add one shared usage-day projection for signup, new-person, and active-group
   reward bases.
2. Route marketing, Settings, runtime tools, and notices through it.
3. Update the durable referral contract and focused coverage.
4. Verify, review, push, and merge the corrective PR.

## Decisions

- Reuse the repository's intended 10-day and 14-day referral presentation from
  the prior referral design work.
- Keep USD micros as the sole accounting and persistence unit.

## Verification

- Commands to run: focused referral Vitest projects, scoped ESLint, web
  typecheck, frontend design proof, ReviewGPT gates, and required PR CI.
- Expected outcomes: no dollar-denominated referral labels remain on scoped
  user-facing surfaces; all checks pass on the pushed PR head.
Completed: 2026-08-09
