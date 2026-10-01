# Suppress progress updates during routine onboarding

Status: completed
Created: 2026-08-30
Updated: 2026-08-30

## Goal

- Keep routine onboarding silent until Murph has the substantive reply, even
  when the runtime must read its onboarding policy and saved context first.
- Correct the shared model instruction only; do not add timing machinery,
  route-specific state, or another progress owner.

## Success criteria

- The production-composed direct-message prompt explicitly excludes routine
  onboarding overhead from the progress threshold.
- A focused real GPT-5.6 onboarding journey performs the required reads and
  sends no progress update while still producing the correct next question.
- Focused deterministic tests, typecheck, required ReviewGPT gates, and exact
  PR-head CI pass.
- The merged head is deployed to Web and the managed Cloudflare runner, and a
  live production journey confirms the progress update is absent.

## Scope

- In scope: the single shared progress instruction, its deterministic contract
  test, one production-derived real-model regression, review, deployment, and
  live proof.
- Out of scope: queues, timers, hard-coded onboarding route suppression,
  provider changes, and redesigning the one-reply Web-to-runtime handoff.

## Constraints

- Technical constraints: keep model ownership; count only genuinely
  substantive work beyond routine policy/context/setup overhead.
- Product/process constraints: use synthetic fixtures only, preserve canonical
  onboarding behavior, and follow the prompt-primary PR/ReviewGPT lane.

## Risks and mitigations

1. Risk: an overly broad exclusion hides useful updates during genuinely long
   user-requested work.
   Mitigation: exclude only routine onboarding/setup overhead; retain the
   existing global threshold for separate long research or external action.
2. Risk: a stochastic test passes without matching production composition.
   Mitigation: build from production prompt/tool builders and pair it with an
   exact deterministic prompt assertion.

## Tasks

1. Add a focused regression for the observed onboarding shape.
2. Tighten the shared instruction without new runtime machinery.
3. Run deterministic and real-model verification and inspect the reply.
4. Push a scoped PR, run the prompt-primary preliminary ReviewGPT pass with
   CI, remediate accepted findings, and merge.
5. Deploy both production surfaces and replay the live journey.

## Decisions

- Treat the live production canary as authoritative evidence that the first
  wording remained too permissive.
- Keep `murph.send_progress_update` model-controlled; correct the one shared
  instruction rather than add a feature-specific gate.
- Accept ReviewGPT's product finding that a blanket onboarding exclusion could
  hide useful feedback during substantive return-stage work. Routine setup does
  not count, while otherwise-qualifying work still uses the shared threshold.
- Accept ReviewGPT's coverage finding by exposing the real progress tool in the
  existing wearable-onboarding journey. This adds test proof only, not runtime
  state or another policy owner.

## Verification

- Commands to run: focused prompt-contract Vitest, assistant package
  typecheck, the uniquely named `pnpm test:assistant:live` journey, exact-head
  CI, production deploy workflows, and the live Linq canary plus narrow ledger
  and runtime-log checks.
- Expected outcomes: no progress tool call in routine onboarding, one useful
  onboarding reply, green required gates, and deployed fingerprints containing
  the merged commit.
- Local results: the prompt contract passed (3 tests), assistant-engine
  typecheck passed, a fresh GPT-5.6 onboarding turn sent zero progress updates,
  the representative wearable sequence sent zero updates across its setup and
  device actions, and a three-source GPT-5.6 task sent exactly one update before
  its first qualifying read.
Completed: 2026-08-30
