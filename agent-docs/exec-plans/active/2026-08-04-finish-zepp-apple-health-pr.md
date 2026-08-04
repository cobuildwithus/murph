# Finish Zepp Apple Health onboarding PR

Status: active
Created: 2026-08-04
Updated: 2026-08-04

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
- Place Zepp after Garmin and before Fitbit in the existing popularity order;
  do not pin it beside Apple Health merely because Apple Health is the relay.
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
  bytes at base and 31,026 / 141,406 at head (+136 tokens, +0.4403%; +516
  bytes, +0.3662%). Group measured 26,617 tokens / 121,971 bytes at both base
  and head (zero delta) because private setup and account-start guidance is not
  rendered for group scope.
- The preferred Claude Fable UI reviewer reported explicit credit exhaustion;
  the prescribed Opus fallback was attempted once and timed out without a
  result. No local substitute was added.
