# Make repeated-action advice include bounded follow-through

Status: completed
Created: 2026-09-23
Updated: 2026-09-23

## Outcome and protected boundaries

In private problem-solving conversations, a repeated-action proposal includes
an actionable cue, finite support offer, and review decision. The member need
not know to ask for accountability. Declines, clinical safety, and authorization
remain authoritative. A proposal never falsely claims scheduled outreach.

## Evidence and owner

The direct turn-priority prompt asks for a bounded trial but does not require
an accountability offer. The routing bridge makes behavior-followthrough
conditional, while that skill limits its complete launch authorization wording
to first onboarding. Existing experiment and automation owners already support
bounded reminders, check-ins, and reviews. Correct those instructions; add no
scheduler, schema, dependency, or persisted state.

Official GPT-6 guidance recommends explicit follow-through and auditing
conflicting skills. Its examples derive primarily from Astra and need testing
on the selected Sol workload:
https://developers.openai.com/api/docs/guides/latest-model#initiative-and-follow-through

## Journeys and scope

- New repeated-action request: useful proposal plus concrete support offer.
- Timing missing: useful proposal and one narrow schedule question.
- Declined support: useful plan, no re-offer or scheduled mutation.
- Accepted concrete support: execute the bounded actions without another consent loop.
- Group and urgent-care paths retain their existing owners.

No production member mutation, outbound message, merge, or deployment.
Private evidence stays out of repository artifacts; tests use unrelated
synthetic activity scenarios. Trial length follows the domain, not a universal
two-week prescription. Existing active plans are reused rather than duplicated.

## Verification

- Composed prompt and skill contracts: 129 passed, 7 pre-existing skips.
- Assistant-engine typecheck: passed.
- Changelog generation and page tests: 10 passed.
- Documentation drift and diff whitespace checks: passed.
- Complexity guard: passed; no source complexity change. Existing hotspots
  are unrelated to the changed routing string.
- Privacy review: synthetic fixtures only; no private transcript or identifiers.
- GPT-6 Sol through local subscription: all three new journeys passed with
  zero automation calls and unchanged goals, regimens, and experiments. Known
  timing produced a finite reminder/check-in offer; missing timing produced
  one cue question; declined support produced only the requested plan.
- Reply review for those three journeys: Ready. No false scheduling claims,
  duplicate effects, or renewed support offer after a decline.
- Existing accepted-package journey: passed on GPT-6 Sol (five provider turns).
  It saved one Goal, one regimen, three reminders, and one review, then reused
  that package in a fresh session without mutations. Its cold-session check
  also honored a decline of reminders and experiments. Reply review: Ready.
  An earlier sample failed the required pre-save regimen-inventory assertion;
  the final run captures and verifies that read explicitly. This is live-model
  sampling evidence, not a guarantee of every future response.
  Its discovery matcher now
  checks purpose markers in the actual question instead of requiring narrow
  question openings.
  The synthetic member requests separate ISO date/time entries so exact saved
  times can be compared without a general natural-language schedule parser.
  All persistence, consent, support-count, timing, and deduplication assertions
  remain unchanged. The existing four schedule-evidence tests pass.

Commands used:

- `pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts --no-coverage test/model-behavior.test.ts test/experiment-onboarding-skill-guidance.test.ts test/assistant-skill-assets.test.ts`
- `pnpm --dir packages/assistant-engine typecheck`
- `pnpm --dir apps/web changelog:generate`
- `pnpm exec vitest run --config apps/web/vitest.config.ts --no-coverage apps/web/test/changelog-page.test.tsx`
- `pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts --no-coverage test/assistant-codex-real-e2e.test.ts -t 'public goal preview schedule evidence'`
- `pnpm test:assistant:live -- --test '<exact journey name>' --model gpt-6-sol`
  with an authenticated local subscription selected through the CLI's supported
  home override. Each of the three new parameterized journeys and the existing
  accepted-package journey ran separately; no production messages were sent.
- `pnpm complexity:diff`, `pnpm docs:drift`, and `git diff --check`.

The always-on route grows by only 30 characters, within the unchanged prompt
budget. This is an authored-text delta, not a full provider-token measurement.
Group prompt routing is unchanged. No runtime owner, DB/network API, persisted
shape, migration, or scheduling mechanism changes.
Runtime behavior changes are prompt-primary; final external ReviewGPT is not
required unless implementation expands to an independently sensitive owner.

## Delivery and follow-up

Changelog: `2026-09-23/plans-with-follow-through`; no PR number exists for this
local task. No deployment performed. After release, verify that a private
repeated-action proposal offers finite support, then confirm that acceptance
persists the agreed support and a decline remains quiet. Existing automation
storage and scheduling contracts are unchanged.

Frog: `.agents/friction-log/20260923204734-goal-setup-live/friction.md` records
the test-fixture friction and its scoped correction.
Completed: 2026-09-23
