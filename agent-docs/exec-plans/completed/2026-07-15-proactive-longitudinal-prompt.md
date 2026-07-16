# Proactive longitudinal assistant prompt

Status: completed
Created: 2026-07-15
Updated: 2026-07-15

## Goal

- Make Murph understand that proactive reminders and contextual outreach are a
  core advantage over ordinary chatbots, and that useful health help depends on
  building a rich, durable picture of the member over time.

## Success criteria

- The strategy and supporting product docs describe proactive outreach as a
  first-class capability rather than a reluctant exception.
- The direct assistant prompt tells Murph to keep resolving material unknowns
  with as many useful questions as the active problem requires, while using
  known evidence first and respecting member redirection or refusal.
- The direct assistant prompt gives reminders, check-ins, monitoring, and
  contextual outreach clear strategic weight while preserving authorization,
  route, pacing, safety, and stop controls.
- The static prompt budget allows up to 8,000 characters and regression tests
  prove the intended wording and prompt-cache fingerprint.
- Focused verification and the required independent prompt-review pass finish
  with no unresolved accepted finding.

## Scope

- `packages/assistant-engine/src/assistant/system-prompt.ts`
- `packages/assistant-engine/src/assistant/model-behavior.ts`
- `packages/assistant-engine/src/assistant-codex/dynamic-tools.ts`
- `packages/assistant-engine/src/assistant-codex/dynamic-tools/generate-song.ts`
- `packages/assistant-engine/src/assistant-codex/dynamic-tools/generate-voice-memo.ts`
- `packages/assistant-engine/test/model-behavior.test.ts`
- `packages/assistant-engine/test/dynamic-tools-generate-image.test.ts`
- `agent-docs/strategy.md`
- `agent-docs/PRODUCT_SENSE.md`
- `agent-docs/PRODUCT_CONSTITUTION.md`
- `agent-docs/product-marketing-context.md`
- `agent-docs/index.md`
- this plan and the coordination ledger

## Constraints

- This is prompt-primary: no new scheduler, transport, authorization, state, or
  delivery behavior.
- User-directed depth replaces the prior one-question discovery strategy, but
  questions must still use known evidence, advance a real health decision, and
  stop or change course when the member redirects, declines, or needs immediate
  help.
- Proactivity remains bound to existing automation authorization, current route
  authority, recipient-local timing, line health, privacy, and medical-safety
  rules.
- Preserve unrelated working-tree edits and active prompt work in other
  worktrees. Keep edits localized to direct-only prompt sections and matching
  regression-test seams.

## Risks and mitigations

1. Risk: deeper discovery becomes a questionnaire or delays help.
   Mitigation: ask compact, decision-relevant questions, pace them naturally,
   give useful interim help, and honor redirection or refusal.
2. Risk: stronger proactivity becomes spammy or nagging.
   Mitigation: distinguish proactive offers from authorized scheduled outreach,
   require a clear purpose, adapt stale support, and keep existing deliverability
   and stop rules.
3. Risk: prompt growth creates repetition or cache churn.
   Mitigation: compress overlapping guidance, cap the direct static core at
   8,000 characters, and update the pinned prompt fingerprint intentionally.
4. Risk: concurrent prompt branches create merge conflicts.
   Mitigation: work in an isolated task branch, keep the new strategy direct-only,
   and avoid developer-instruction assembly and connected-app enumeration.

## Tasks

1. Inspect the current prompt stack, regression tests, durable product rules,
   and active overlapping prompt branches.
2. Reconcile the strategy and supporting product docs with deeper discovery and
   more proactive outreach.
3. Rewrite the direct assistant identity and context guidance; raise the
   static-core test budget to 8,000 characters.
4. Update prompt-content and fingerprint regressions.
5. Run focused verification, the required prompt-review pass, final privacy and
   diff review, then close the plan with a scoped commit.

## Decisions

- “As many questions as needed” means enough compact, useful questions to
  resolve the material unknowns behind the active health problem; it is not a
  mandate to collect every possible fact or finish a universal profile.
- Murph should default to offering relevant follow-through when a goal,
  recurring friction, time-sensitive action, monitoring opportunity, or
  unresolved thread would benefit. Actual recurring outreach still uses
  existing authorization and owning automation rules.
- More context can justify more discovery now and better outreach later. The
  long-run payoff remains less repetition, stronger judgment, and better-timed
  support rather than maximum message volume.
- Proactive rich media follows a request, known modality preference, or an
  owning flow that explicitly marks the modality welcome and privacy-safe.

## Verification

- Passed the focused prompt/tool regression lane: 3 files, 87 tests.
- Passed the rebased full assistant-engine suite: 157 files, 2,287 tests, with
  one file and five tests skipped by the existing suite.
- Passed assistant-engine typecheck, `pnpm docs:drift`, `git diff --check`, the
  prompt size and fingerprint guards, and the identifier privacy scan.
- `pnpm test:diff` passed dependency policy, boundary and architecture guards,
  all affected typechecks, and the assistant-engine, assistant-runtime,
  assistant-cli, assistantd, and setup-cli suites. The broader lane was stopped
  after failures in untouched CLI expansion tests for experiment journals,
  interventions, and sample audits, including repeated 60-second timeouts; the
  prompt and tool-description diff does not touch those command paths.
- The required independent prompt review used the current official GPT-5.6
  prompting guide. Its two medium findings—diminishing-value discovery and
  rich-media modality eligibility—were remediated, and the narrow re-review
  reported no unresolved findings.
- Rebased onto the current `origin/main`; post-rebase focused tests, full
  assistant-engine tests, typecheck, docs drift, diff, and privacy checks pass.
Completed: 2026-07-15
