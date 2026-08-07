# Finish Zepp Apple Health onboarding PR

Status: completed
Created: 2026-08-04
Updated: 2026-08-07

## Goal

- Ship PR #1272 as a real Zepp/Amazfit onboarding path: expose it on `/connect`
  in the provider list's popularity order, guide iPhone members through the
  Zepp-to-Apple-Health relay, and let Murph help an inbound iMessage participant
  sign up before continuing setup when they are not yet a member.

## Success criteria

- The PR contains source and test changes rather than temporary patch-runner
  workflows.
- Zepp/Amazfit is ordered consistently with the existing popularity-ranked
  provider catalog instead of being pinned directly after Apple Health.
- The setup dialog and Murph handoff accurately describe Zepp as an Apple Health
  relay and do not claim direct Zepp cloud access or historical backfill.
- The assistant prompt handles both existing members and inbound non-members,
  using the existing signup/app handoff before Apple Health setup and preserving
  iMessage deliverability rules.
- Focused tests, typecheck, prompt-size proof, rendered desktop/mobile evidence,
  preliminary ReviewGPT specialist review, required exact-head CI, and final
  parent review all pass.

## Scope

- In scope: `/connect` source presentation and setup guide, the real design
  catalog study, Murph's wearable setup prompt guidance, focused regression
  coverage, PR evidence, and removal of the two temporary Zepp workflows.
- Out of scope: a direct Zepp cloud/OAuth provider, Zepp OS mini-app ingestion,
  Android relay support, historical Zepp backfill, and new signup infrastructure.

## Constraints

- Technical constraints: reuse the current Apple Health companion setup, device
  setup-guide dialog, contact handoff, and existing signup/app-link authority;
  Apple Health remains the authoritative synced source.
- Product/process constraints: do not fabricate provider capabilities or links;
  do not frame an inbound iMessage reply as automated acquisition; keep the UI
  accessible, responsive, cataloged, and recoverable.

## Risks and mitigations

1. Risk: the UI or assistant implies a native Zepp connection.
   Mitigation: label the relay steps explicitly and cover the no-direct-access
   boundary in tests.
2. Risk: signup guidance conflicts with iMessage line-health policy.
   Mitigation: scope signup help to the person's current inbound request and
   reuse the existing direct-conversation app/sign-in handoff.
3. Risk: prompt growth or stale exact-string assertions make the change brittle.
   Mitigation: keep the prompt delta compact, test outcomes and critical
   boundaries, and measure both individual and group provider inputs.

## Tasks

1. Inspect the current `/connect`, signup, contact-handoff, and assistant prompt
   owners plus the intended patch encoded in the temporary workflows.
2. Choose and document the smallest popularity-consistent Zepp placement.
3. Implement the real setup guide, connect card, design study, prompt guidance,
   and focused coverage; delete temporary patch workflows.
4. Run focused tests, typecheck, prompt-size measurement, and browser/design
   proof on desktop and mobile.
5. Commit and push the exact candidate, run preliminary ReviewGPT specialists
   with product/prompt/frontend/coverage lenses, resolve findings, then require
   green exact-head CI and complete the PR description.

## Decisions

- Treat Zepp/Amazfit as an Apple Health setup path, not a durable provider
  account or direct integration.
- Preserve the existing signup and Murph contact owners rather than adding a new
  registration route or messaging workflow.
- Place Zepp after Strava and before Withings in the existing popularity order;
  external adoption proxies do not support placing it ahead of Fitbit, and it
  should not be pinned beside Apple Health merely because Apple Health is the
  relay.
- Keep direct-conversation account-start guidance conversational and first-party:
  web creates the account, the iPhone app signs in, and the assistant neither
  invents a personal link nor pressures the person.

## Verification

- Commands to run: focused `apps/web` connect tests, focused assistant prompt
  tests, relevant package typechecks, frontend design-proof checks, prompt input
  size measurement, hosted browser proof, ReviewGPT specialist pass, and PR
  checks on the exact pushed head.
- Expected outcomes: all checks pass; screenshots show the real catalog study on
  desktop and mobile; ReviewGPT reports no unresolved findings; the PR is green
  and ready for review.

## Verification log

- Focused Web Vitest: 89 tests passed across the connect page and shared setup
  dialog.
- Focused Assistant Engine Vitest: 71 prompt and behavior tests passed; the
  stable route capability prompt remains within its size budget.
- Focused Device Sync Vitest: 112 config and public-ingress tests passed.
- Web, Assistant Engine, and Device Sync typechecks passed. Web lint completed
  with zero errors and only pre-existing warnings.
- The exhaustive hosted-visible source-card guard passed 7 tests after adding
  the intentionally display-only Zepp catalog source to its expected set.
- The real production design-catalog dialog was rendered and inspected at 1440
  CSS pixels and 390 CSS pixels. Both settled screenshots are legible and show
  the relay steps plus the Murph continuation action.
- Complete first-provider request capture used the pinned real Codex App Server,
  `gpt-5.6-terra`, low reasoning, production code mode, 16 representative
  direct tools, 13 representative group tools, and `gpt-tokenizer` 3.4.0
  `o200k_harmony`. It counted `input`, `tools`, `tool_choice`,
  `parallel_tool_calls`, `include`, and `text`, including Codex-generated tool
  guidance and schemas; it excluded transport/cache/account metadata equally
  and normalized temporary paths. Direct measured 30,890 tokens / 140,890
  bytes at base and 31,026 / 141,389 at head (+136 tokens, +0.4403%; +499
  bytes, +0.3542%). Group measured 26,617 tokens / 121,971 bytes at both base
  and head (zero delta) because private setup and account-start guidance is not
  rendered for group scope.
- The preferred Claude Fable UI reviewer reported explicit credit exhaustion;
  the prescribed Opus fallback was attempted once and timed out without a
  result. No local substitute was added.
- Exact-head GitHub Actions passed the release build/typecheck, app verification,
  package and fixture coverage, host matrices, frontend design proof, viewport
  overflow, and repository-hygiene checks at
  `4ca4671c716dbcfefd4974cca530750b3308b9ba`.
- GitHub reports the pushed candidate as cleanly mergeable with the advanced
  base branch; no manual conflict resolution or unrelated base merge is needed.
- Final ReviewGPT round 1 on the first candidate found two valid issues: the
  guide-only Zepp card exposed provider lifecycle semantics and let signed-out
  visitors bypass account authentication, and the prompt delta weakened the
  existing Apple Health availability boundary. The remediation reuses the
  shared authentication owner, resumes successful authentication on `/connect`,
  omits lifecycle state for guide-only cards, and restores the stronger
  unsupported/disabled/coming-soon rule with current iPhone-path guidance.
- Parent candidate review tightened the same guide-only derivation before the
  correction audit: stale reconnect, reset, and unfinished-reset projections
  are now suppressed alongside status and disconnect actions, with an
  impossible-state regression case proving the complete lifecycle boundary.
- Remediation proof passed 104 focused Web tests, 73 Assistant Engine prompt
  tests, both affected package typechecks, the frontend design-proof suite, the
  seven-test exhaustive hosted-visible source guard, scoped Web lint, and
  `git diff --check`.
- Exact-head GitHub Actions also passed on the merged-base remediation head
  `5c214beb2da49ddd88200d77f571a76f1a715e70`, including every required release,
  app, package, frontend, and repository-hygiene check.
- Final ReviewGPT correction round 2 confirmed the guide-only lifecycle and
  Apple Health prompt fixes, then found that a blanket `/connect` auth resume
  would consume a brand-new member's canonical one-shot first-visit journey.
  The accepted correction keeps existing members on `/connect` after auth but
  lets first-visit-eligible signups continue through `/home?initialVisit=true`;
  focused tests cover both outcomes without adding continuation state or a new
  onboarding owner. The resulting focused Web suite passes 111 tests, along
  with Web typecheck, scoped lint, and `git diff --check`.
- The preliminary specialist retry remains invalid only because its closed-card
  desktop and mobile images predate the exact-head removal of the lifecycle dot.
  The open-dialog evidence is current; the two closed-card captures must be
  refreshed from the exact pushed head before the same preliminary pass can be
  accepted.
- Final ReviewGPT round 3 returned `RETROSPECTIVE_REQUIRED` with no tactical
  correction. The recorded architecture decision is to continue the same PR:
  retain the derived `guideOnly` presentation boundary, shared authenticated
  guide access, bounded `/connect` resume, first-visit exclusion, and direct-only
  truthful prompt boundary. Each concept protects an existing owner, and none
  adds durable state or a new manager, lifecycle, queue, service, or workflow.
- The first-reviewed shape was 18 files and `+483/-34`: source `+226/-21`, tests
  `+123/-13`, docs `+126/-0`, and other `+8/-0`. The three review-remediation
  commits added source `+50/-23`, tests `+150/-14`, and docs `+41/-2`. The much
  larger cumulative ancestry delta includes a merged base branch and is not
  review-driven PR growth.
- Hosted app-session issuance remains authoritative for first-visit eligibility,
  AuthProvider for browser completion routing, SourceCard for guide-only
  presentation, and Apple Health for connection lifecycle. The PR body now uses
  the exact “first hosted web visit” boundary instead of equating eligibility
  with member creation, and no longer represents the stale closed-card captures
  as current evidence.
- A follow-up popularity audit rejected the initial Garmin-to-Fitbit placement.
  Current official app-distribution proxies put Zepp below Garmin and Fitbit,
  while US iPhone chart evidence also favors Strava. Zepp now follows Strava and
  precedes Withings. The focused connect-page suite passes 88 tests, and Web
  typecheck, scoped lint, and `git diff --check` pass on the correction.
Completed: 2026-08-07
