# Default reminder model selection to Terra

Status: completed
Created: 2026-08-31
Updated: 2026-08-31

## Goal

- Make ordinary reminder setup select Terra by default and reserve Luna for an
  exceptionally simple, fully self-contained cue that needs no interpretation,
  history, read, tool, judgment, personalization, or safety-sensitive reasoning.

## Success criteria

- The production `murph.automation` guidance tells Murph to save Terra for every
  ordinary reminder unless the complete future turn can only repeat or lightly
  rephrase a fully self-contained stored cue.
- Any uncertainty, contextual decision, canonical/context read, tool use,
  ambiguity, personalization, or sensitive reasoning routes the reminder to
  Terra rather than Luna or inherited conversation selection.
- Non-reminder automations keep their existing Luna/Terra/inherit decision rule.
- Deterministic assembled-tool proof covers the positive rule and the absence of
  the prior broader Luna guidance.
- Two focused production-derived real-Codex journeys independently save a
  trivial reminder with Luna and a contextual reminder with Terra, with exactly
  one successful write and a concise truthful reply in each journey.
- Focused tests and the assistant-engine typecheck pass, the Product UX
  walkthrough is Ready, and the scoped task is committed and opened as a draft
  pull request for exact-head CI.

## Scope

- In scope: model-selection instructions exposed through the existing hosted
  automation tool, deterministic prompt/schema regression proof, one focused
  real-Codex reminder-setup journey, and a member-visible changelog item if the
  shipped outcome meets the changelog owner’s threshold.
- Out of scope: scheduler behavior, reminder cadence or copy policy, schemas,
  persisted model fields, automatic migration of existing automations, model
  availability or billing, and model selection for non-reminder managed jobs.

## Constraints

- Technical constraints: keep Web/vault automation persistence and scheduled
  turn routing unchanged; express the decision in the current model-facing
  automation owner without a classifier, state machine, migration, or new
  abstraction.
- Product/process constraints: this is a Product UX Product change. Preserve
  authorized reminder delivery, the recurring-reminder conversation policy,
  iMessage reciprocity and pacing, and the member’s saved conversation model
  outside the turn-scoped reminder override.

## Risks and mitigations

1. Risk: “simple” remains broad enough that Luna handles reminders requiring
   context or judgment.
   Mitigation: define the Luna exception by the complete absence of concrete
   context, read, tool, ambiguity, personalization, judgment, and safety needs;
   direct every uncertainty to Terra.
2. Risk: a reminder rule accidentally changes newsletters, research, or other
   automations.
   Mitigation: scope the new default explicitly to ordinary reminders and retain
   the existing non-reminder selection rule.
3. Risk: a prompt-only assertion passes while the real model still chooses the
   wrong override.
   Mitigation: inspect the assembled production tool contract, then run one
   focused live comparison journey through the real dynamic tool.
4. Risk: existing reminders are silently rewritten or future replies inherit
   the wrong model.
   Mitigation: change no persistence or execution code; apply the rule only on
   new saves and material reminder-content/context patches, while leaving the
   existing turn-scoped continuity contract intact.

## Product UX plan

- Outcome: reminder quality defaults to Terra, while only a literal, complete
  cue uses the lighter Luna model.
- Entry and promise: a member asks Murph in an authenticated conversation to
  create or materially change a reminder; Murph saves it immediately and the
  scheduled occurrence continues through the ordinary conversation and delivery
  owners.
- Affected people: (1) someone saving a literal cue already complete in its
  stored instructions, who should receive a Luna-backed reminder; (2) someone saving a
  reminder that must consider current plans, records, history, tools, ambiguity,
  personalization, or safety, who should receive a Terra-backed reminder.
- Challenge: defaulting every reminder to Terra would ignore the user’s explicit
  cost/latency exception; treating “self-contained” alone as sufficient would
  preserve the current overbroad Luna path. The complete-turn test keeps the
  exception useful and narrow.
- Proof: production-assembled tool assertions plus independent real-Codex
  journeys that inspect each persisted turn-scoped model override, schedule,
  stored instructions, and final member-visible confirmation.
- Done when: both people receive the intended saved model choice, no extra write
  or question occurs, non-reminder guidance remains intact, and the actual reply
  is concise, warm, and truthful.

## Tasks

1. Finish tracing the automation model-selection owner and confirm no active
   branch overlaps the changed files.
2. Add the deterministic failing regression for Terra-default reminder guidance
   and removal of the broader Luna rule.
3. Update the existing automation tool instructions at the smallest owner.
4. Add and run one focused real-Codex comparison journey, inspect its reply, and
   record the Product UX walkthrough verdict.
5. Run focused tests, typecheck, complexity/diff/privacy inspection, and the
   changelog decision.
6. Close the plan through the scoped commit, push a draft PR, complete parent
   review, and hand exact-head CI ownership to the PR workflow.

## Decisions

- The reminder model decision remains model-authored at save or material patch
  time through `assistantTargetOverride`; no runtime classifier or persisted
  reminder kind is added.
- Terra is the ordinary-reminder default even when the conversation model is
  Luna or Sol. Luna is allowed only for the closed trivial-cue exception.
- Existing stored overrides are not migrated automatically. A later material
  reminder-content/context edit must reassess the complete override; status-only
  or timing-only edits preserve it.
- Other automations retain the current Luna/Terra/conversation-inheritance
  guidance.

## Verification

- Commands to run: focused assistant-engine Vitest files for hosted-domain tool
  guidance and the live journey compile path; assistant-engine typecheck; then
  `pnpm test:assistant:live -- --test "fixed library cue uses Luna"` and
  `pnpm test:assistant:live -- --test "context reminder uses Terra"`;
  `pnpm complexity:diff`; `git diff --check`; exact-head required PR checks.
- Expected outcomes: deterministic guidance assertions pass with no conflicting
  old rule, the live journeys each write exactly one reminder using the intended
  Luna or Terra model with no extra effects and earn Ready reply verdicts,
  focused typecheck is clean, complexity does not increase, and exact-head CI is
  green before merge.

## Results

- Deterministic assistant coverage: 29 focused tests passed across the
  automation schema, model selection, model continuity, and turn-envelope
  suites.
- Real-Codex Product UX proof: Ready. The fixed synthetic cue produced exactly
  one Luna-backed one-shot save at the requested local date and time. The
  contextual daily reminder produced exactly one Terra-backed recurring save
  with the requested current-data review and recommendation instructions. Both
  replies were concise and truthful, named the requested content and cadence,
  exposed no model name, and asked no extra question.
- Typechecks: assistant-engine and hosted Web passed.
- Changelog proof: the focused changelog page suite passed all nine tests.
- Complexity: `pnpm complexity:diff` passed with no changed-file hotspot above
  20 and no complexity-debt increase; no further behavior-preserving
  simplification is justified beyond the two direct guidance edits.
- Provider input: paired normalized captures from the pinned real Codex App
  Server and scripted Responses provider used identical direct and group
  fixtures plus `gpt-tokenizer` 3.4.0 `o200k_harmony`. The complete first
  provider request was byte-for-byte identical at base and head because the
  changed automation contract is deferred: direct remained 28,329 tokens and
  131,998 UTF-8 bytes; group remained 24,299 tokens and 113,575 bytes. Runtime
  paths, random identifiers, timestamps, serialization order, and wall-time
  metadata were normalized; provider output was excluded. Instructions,
  initially advertised tools/schema guidance, and other first-request fields
  were unchanged.
- Privacy/diff review: the user-provided example was removed from every authored
  artifact and replaced by unrelated synthetic fixtures. No direct identifier,
  secret, or user-derived scenario remains in the intended diff.
Completed: 2026-08-31
