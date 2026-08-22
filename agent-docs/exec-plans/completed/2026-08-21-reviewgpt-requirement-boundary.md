# Keep ReviewGPT findings current and proportional

Status: completed
Created: 2026-08-21
Updated: 2026-08-21

## Goal

- Keep ReviewGPT focused on current, PR-caused material risk and deletion while
  preventing speculative future needs from becoming product requirements or
  mandatory fixes.

## Success criteria

- The final and preliminary review prompts state that review is a merge veto,
  not product brainstorming, and distinguish hard invariants from product
  guidance that is not a backlog.
- New fields, state, controls, and ownership paths require a current writer,
  current consumer, and present-day outcome or invariant.
- Exceptional states are reviewed only when the change touches them or concrete
  evidence makes them material.
- Every substantive ReviewGPT result pauses before remediation and reports the
  parent's evidence-backed accepted or rejected dispositions.
- A parent may reject speculative or disproven findings without changing code
  merely to obtain a model-authored `PASS`.
- Focused policy coverage passes and direct-push acceptance runs exactly once
  before the scoped commit is pushed to `main`; unrelated current-main or local
  environment failures are recorded with path evidence.

## Scope

- In scope: the canonical final and preliminary ReviewGPT prompts, Product UX
  planning/review guidance, ReviewGPT completion-loop policy, top-level agent
  routing docs, focused policy assertions, and this plan.
- Out of scope: ReviewGPT browser/capture implementation, production product
  behavior, data schemas, and unrelated audit presets.

## Constraints

- Technical constraints: preserve exact-head evidence, round lineage, output
  markers, accepted-finding remediation, and invalid/retrospective stop rules.
- Product/process constraints: prefer deletion and one compact decision rule;
  do not encode private examples or turn repository guidance into a feature
  backlog.

## Risks and mitigations

1. Risk: allowing parent rejection weakens the independent review gate.
   Mitigation: require concrete code/path evidence, user-visible pause, and a
   recorded reason for every rejection; unresolved accepted findings still
   block completion.
2. Risk: another anti-speculation paragraph makes the already long prompt
   worse.
   Mitigation: delete the exhaustive exceptional-state checklist and replace it
   with a shorter requirement boundary and touched-state rule.

## Tasks

1. [x] Inspect the current prompts, workflow, tests, and official GPT-5.6 prompt
   guidance.
2. [x] Tighten the final and preliminary ReviewGPT prompts and Product UX owner.
3. [x] Add the review-result pause and parent-rejection completion rule to the
   canonical workflow and agent routing docs.
4. [x] Update focused policy coverage, run verification and acceptance, inspect
   the final diff, and prepare the scoped direct-main commit and push.

## Decisions

- Treat ReviewGPT output as an adversarial signal; the parent owns disposition.
- Pause after each substantive result before any remediation or next review.
- Permit final-stage `FINDINGS` to resolve only when local triage accepts none
  and records evidence for every disposition. The one-pass preliminary stage
  may also resolve after every accepted finding is fixed and verified.
- Keep `INVALID` and `RETROSPECTIVE_REQUIRED` as stop conditions.

## Verification

- Focused CLI release policy coverage.
- Documentation drift and diff checks.
- Identifier/privacy scan of changed text.
- `pnpm verify:acceptance` once on the reconciled direct-push candidate.

## Verification Results

- Passed the focused ReviewGPT prompt-budget and Product UX policy tests.
- Passed the CLI package typecheck, agent-doc drift check, diff check, and
  changed-text identifier scan.
- The complete release policy audit remains blocked by a current-main assertion
  for ReviewGPT driver behavior outside this diff; the touched policy slices
  pass independently.
- `pnpm verify:acceptance` ran once after reconciling with `origin/main`. It
  stopped on two existing workspace-boundary imports outside this diff and a
  local Cloudflare typecheck that could not resolve its already-declared
  `openai` dependency. No failing path or dependency manifest is changed here.
Completed: 2026-08-21
