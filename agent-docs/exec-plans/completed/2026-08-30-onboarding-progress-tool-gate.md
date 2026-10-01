# Gate progress delivery while onboarding is open

Status: completed
Created: 2026-08-30
Updated: 2026-08-30

## Goal

- Keep member-visible progress updates unavailable while the existing private
  onboarding guidance is open.
- Reuse the current onboarding and dynamic-tool owners; add no new state,
  service, classifier, queue, or dependency.

## Success criteria

- The production-composed onboarding turn omits
  `murph.send_progress_update` and says interim progress is unavailable.
- Ordinary post-onboarding long work retains the existing progress tool and
  threshold.
- Deterministic tests, assistant typecheck, focused real-model journeys,
  ReviewGPT, and exact-head CI pass.
- Web and the hosted runner deploy successfully, and the production canary
  completes without an onboarding progress delivery.

## Evidence and scope

- Production proof showed one onboarding turn call the progress tool after
  only one routine command, despite the prompt exclusion added in PR #2571.
- The follow-up is limited to the existing dynamic-tool availability decision,
  its composed prompt/tool tests, focused real-model coverage, deployment, and
  live proof.
- General progress behavior, onboarding state ownership, delivery machinery,
  provider configuration, and canary architecture are out of scope.

## Risks and mitigations

1. Risk: suppressing progress for a substantive request received before
   onboarding closes.
   Mitigation: the suppression is bounded by the existing onboarding-guidance
   lifecycle and disappears automatically when that owner closes onboarding.
2. Risk: prompt-only proof repeats the production miss.
   Mitigation: enforce absence in the dynamic-tool catalog and assert both tool
   omission and the composed unavailable guidance deterministically.

## Tasks

1. Add the deterministic failing regression around production planning.
2. Derive progress availability from the existing onboarding-guidance flag.
3. Run focused deterministic, typecheck, and real-model verification.
4. Push a scoped PR, run required ReviewGPT and CI, and remediate accepted
   findings.
5. Merge, deploy both production surfaces, and replay the live canary with
   narrow delivery/runtime proof.

## Verification

- Focused planning/tool/prompt Vitest coverage.
- `pnpm --filter @murphai/assistant-engine typecheck`.
- Focused onboarding and post-onboarding long-work real-Codex journeys through
  `pnpm test:assistant:live`.
- Exact-head required GitHub checks, production deploy workflows, and the live
  Linq production canary.

## Local results

- The focused planning suite passed all 101 tests after first proving the new
  assertion failed against the prior implementation.
- Assistant-engine typechecking and `git diff --check` passed.
- A real GPT-5.6 onboarding journey passed with progress unavailable and the
  expected identity questions.
- A real GPT-5.6 post-onboarding multi-source journey passed with exactly one
  natural progress update before the substantive reply.
- The implementation reuses `onboardingGuidanceOpen` to filter the existing
  dynamic-tool catalog; it adds no persisted state or runtime component.
Completed: 2026-08-30
