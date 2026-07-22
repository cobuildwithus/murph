# Hosted low-usage conversation skill

Status: completed
Created: 2026-07-22
Updated: 2026-07-22

## Goal

- Replace the generic low-usage warning behavior with one short, natural
  continuation that fits the current plan context.
- Give Murph a dedicated skill for direct trials, direct paid plans, Family
  sponsorship, and hosted group chats without moving billing authority into the
  assistant.

## Success criteria

- Trusted low-usage context makes Murph read the dedicated skill after handling
  the member's current request.
- The initial mention is one final `---`-separated segment rather than a string
  of status, forecast, link, and disclaimer bubbles.
- Trial, paid, Family, and group follow-ups name only options the current web
  billing and funding owners actually support.
- The first commercial mention stays short, reply-oriented, link-free, and
  low-pressure.
- Prompt and skill regression tests, diff-aware verification, prompt review,
  final review, and the scoped commit all pass.

## Scope

- Assistant low-usage system/tool guidance and skill registration.
- One new package-owned hosted low-usage skill.
- Focused assistant-engine prompt, tool-description, and skill tests.
- The current hosted plan-usage product contract.

## Constraints

- Keep Web as the sole owner of plan, allowance, recommendation, funding, and
  payment truth.
- Do not add an automatic notice, watcher, billing tool, state owner, or
  checkout path.
- Do not expose usage percentages, internal accounting, contributor identity,
  or payer identity in the unsolicited low-usage mention.
- Preserve explicit confirmation before subscription actions and verified
  webhook authority before usage is added.
- Preserve unrelated working-tree and coordination-ledger changes.

## Tasks

1. Trace the existing low-usage bit, plan-usage projection, Family rules, and
   group funding surface.
2. Add and register the dedicated skill, then route trusted low-usage context
   to it from the stable assistant prompt.
3. Add focused regression coverage and align the product contract.
4. Run diff-aware verification, the required prompt-review pass, parent final
   review, plan closure, and scoped commit.

## Evidence

- Current prompt guidance permits one vague sentence but contains no plan-aware
  scenario policy, which allows the model to expand the warning into several
  billing-style bubbles.
- `murph.plan_usage` already returns the authoritative direct plan kind,
  period, forecast, and thresholded action for one trusted manual private
  check.
- Family members cannot buy personal top-ups; Family Pulse seats can be moved
  to Edge by the plan owner, while Family Edge has no higher current tier.
- Group usage is separate from personal plan usage and exposes a funding URL
  only through `murph.group action="read_usage"` after the group asks.
- Fresh forward evaluations passed for direct trial, direct paid, Family,
  group, multi-bubble, urgent/sensitive, explicit group-funding, reset-date,
  and non-bubble routes.
- Focused assistant-engine verification passed: 6 files and 110 tests.
- Canonical `pnpm test:diff ...` passed across the affected workspace lanes.
- Canonical `pnpm verify:acceptance` passed, including package coverage, the
  hosted web build, and Cloudflare worker tests.
- The final `prompt-review` pass reported zero findings. The skill creator's
  standalone validator could not start because local Python lacks PyYAML, so
  the repository skill parser and behavior tests supplied the validation.
Completed: 2026-07-22
Completed: 2026-07-22
