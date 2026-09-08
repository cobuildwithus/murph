# Preserve workout completion context and explicit repetition conventions

Status: active
Created: 2026-09-08
Updated: 2026-09-08

## Goal

- Let a private set-completion reply use its established canonical owner and
  explicit member repetition convention without repeated clarification.

## Success criteria

- An exact workout relationship remains available after an answered or quiet
  intervening turn consumes the original delivery; its text and scheduling
  metadata do not replay.
- Newer clear, ambiguous, or different-owner context decisions supersede that
  relationship. Route isolation and causal timestamp bounds still apply.
- Legacy reminder inspection follows typed references to the canonical routine.
  An experiment completion does not require creating a separate daily workout.
- A saved every-set instruction is applied only to its proven workout/exercise
  scope and persisted through the existing repetition-rule command. Prior
  actuals and planned targets alone never establish a member rule.
- Focused deterministic and real-assistant journeys, typecheck, and parent
  privacy/ownership/complexity review substantiate the change.

## Scope

- In scope: the existing auto-reply context reader, three workout/routine skill
  owners, an explicit-clear value in the existing exercise field, regression
  coverage, owner documentation, and a release note.
- Out of scope: new state owners or fields, automatic workout selection, inferred
  repetition rules, snapshot architecture changes, production record edits,
  deployment, and historical incident attribution without retained evidence.

## Constraints

- Keep delivery replay/claim consumption with the current receipt owner.
  Retained references are interpretation hints requiring canonical reads.
- Keep live-set results and exercise defaults with their existing workout
  owner; repeated routine occurrences stay with their experiment owner.
- Use independent synthetic examples and avoid private source material.

## Risks and mitigations

1. A stale workout could override a newer context decision.
   Mitigation: inspect the latest explicit decision in bounded same-route
   causal delivery history; preserve all existing clear/supersession barriers.
2. An old reminder could acquire new occurrence authority.
   Mitigation: carry only the consumed exact workout reference, with no prior
   message or automation occurrence metadata and no new delivery claim.
3. Matching exercise names could incorrectly copy a prescription.
   Mitigation: require successful canonical reads proving the explicit member
   instruction applies to this exact workout/exercise; preserve current rules
   and ask narrowly on conflicts.
4. Field omission previously represented both unestablished and withdrawn rules.
   Mitigation: retain explicit withdrawal as null in the same exercise field;
   older strict readers must be replaced before a null value is written.

## Tasks

1. Implement and test context retention through real receipt transitions.
2. Replace overlapping skill guidance with canonical recovery and rule saving.
3. Add focused real-Codex journeys for legacy cues and durable rule recovery.
4. Preserve explicit clears in the existing exercise field and verify recovery
   does not resurrect a withdrawn instruction.
5. Update the owning contracts and release note, then run focused verification.
6. Review the full candidate, simplify, and commit the scoped change.

## Decisions

- Local reproduction established that the replay watermark can consume an
  exact workout relationship while the canonical workout remains unchanged.
- Existing workout commands already persist and reuse explicit exercise
  repetition rules; ordinary actuals intentionally do not infer such a rule.
- Reader-side retention covers both answered and quiet intervening turns.
  Copying context onto every outgoing message would miss quiet turns and
  create unnecessary coupling between reply delivery and workout identity.
- Parent review traced clear through the canonical writer: it removed the
  exercise field while leaving older external instructions intact. A nullable
  existing field preserves this distinction without coupling withdrawal to
  a second write in memory or a broader experiment plan.
- Product journeys: private live completion after answered/quiet turns;
  legacy routine cue without a daily workout; scoped saved convention;
  missing or conflicting convention; newer/cross-route context barriers.

## Verification

- Focused assistant automation event-path and skill contract tests.
- Focused opt-in real-Codex journeys through production instructions and
  canonical command surfaces, with exact write and reply assertions.
- Assistant-engine typecheck; changelog page test and Web typecheck.
- Diff whitespace/privacy review and `pnpm complexity:diff`.
- Completed deterministic coverage: 123 automation event-path tests, 17 skill
  contract tests, 17 workout delivery-context tests, one live-helper command
  classifier test, 122 canonical workout/CLI/contract tests, and nine changelog
  page tests. The receipt-retention and explicit-clear regressions were first
  reproduced against the previous behavior.
- Typechecks passed for contracts, operator-config, vault-usecases, CLI,
  assistant-engine, and Web. Contract generation and prepared artifact checks
  passed. `pnpm complexity:diff --base HEAD` passed with no debt or maximum
  complexity increase across the four authored source files. No new awaited
  database, network, or provider operation was added to the foreground path.
- Focused live subscription journeys on `gpt-5.6-terra` passed legacy reminder
  recovery, scoped repetition recovery followed by a fresh final-set turn, and
  refusal to infer a rule from matching plan targets and prior actuals. Tool
  effects and actual replies were reviewed. The withdrawal journey remains
  `Hold`: a retained synthetic provider trace proved the previous dense rule
  paragraph was visible, but the model restored an older saved instruction over
  canonical null. Temporary action-output diagnostics had falsely reported
  absent guidance because they missed code-mode output; they were removed.
- Replaced that paragraph with a three-case decision table at the same skill
  owner, then reran all 17 skill checks and assistant-engine typecheck
  successfully. The final live attempt still failed before any provider action
  with `ASSISTANT_CODEX_FAILED`, stage `turn_failed`, status `failed`.
  Every available authenticated subscription home has been attempted; the
  selected home still reports a valid subscription login. No definite
  authentication, quota, or connectivity cause is established.
- Required next proof on a working local subscription:
  `pnpm test:assistant:live -- --test "keeps an explicitly cleared repetition rule withdrawn despite an older saved instruction"`.
  Then rerun the scoped saved-instruction journey affected by the table
  reordering. Do not weaken the zero-write or canonical-null assertions.
  The parent reviewed the final table and source diff. At the user's request,
  publish the candidate as a draft PR with this evidence gap explicit. Keep
  the plan active until the remaining live journeys pass and required final
  review and CI complete; the draft is not deployment-ready.
- Parent and independent source review found no additional ownership or
  coupled-state issue. Historical omitted fields cannot reveal old withdrawals;
  this change preserves the distinction for new explicit clears. No production
  data was changed, and unavailable historical provider traces remain outside
  the claims of this local proof.
