# Narrow routine progress prompt scope

Status: completed
Created: 2026-08-30
Updated: 2026-08-30

## Goal

- Keep the progress tool available for explicit receipts and genuinely long
  work while making routine onboarding and setup default to the final reply.
- Reuse the existing execution-behavior prompt as the sole decision owner; add
  no state, classifier, service, queue, timer, or delivery branch.

## Evidence and scope

- Production showed the existing wording still allowed a progress call during
  a routine onboarding turn.
- ReviewGPT correctly found that the proposed onboarding-lifecycle tool gate
  would also suppress required lab, child-start, and slow-work updates because
  onboarding may remain open indefinitely.
- The remediation deletes that blanket gate and tightens only the existing
  direct-progress paragraph plus its focused prompt and real-model proof.

## Verification

- Focused prompt and model-behavior tests.
- Assistant-engine typecheck and `git diff --check`.
- Real GPT-5.6 routine-onboarding journey with the progress tool available and
  zero progress calls.
- Existing post-onboarding long-work control with one progress call.
- ReviewGPT correction round, exact-head CI, production deploy, and live canary.

## Local results

- Focused progress, model-behavior, and route-planning coverage passed all 180
  tests.
- Assistant-engine typechecking and `git diff --check` passed.
- The bounded second real GPT-5.6 routine-onboarding run passed with the
  progress tool available, zero progress calls, the onboarding skill loaded,
  and the expected identity questions. The first run also made zero progress
  calls and asked the correct questions, but omitted a separate skill-file read.
- The real GPT-5.6 post-onboarding recovery control passed with exactly one
  progress update before four substantive commands and a complete final reply.
Completed: 2026-08-30
