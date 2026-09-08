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

- Deterministic coverage: 123 automation event-path tests, 17 skill contract
  tests, 17 workout delivery-context tests, one live-helper command classifier
  test, 122 canonical workout/CLI/contract tests, and nine changelog page tests.
  Receipt-retention and explicit-clear regressions were first reproduced
  against the previous behavior.
- Typechecks passed for contracts, operator-config, vault-usecases, CLI,
  assistant-engine, and Web. Contract generation and prepared artifact checks
  passed. Complexity comparison with the task base passed with no debt or
  maximum increase across the four authored source files. No new awaited
  database, network, or provider operation was added to host context assembly.
- Four focused live subscription journeys on `gpt-5.6-terra` pass:
  legacy experiment reminder recovery without a daily workout; scoped rule
  recovery followed by a fresh final-set turn; refusal to infer a rule from
  matching plan targets and prior actuals; and explicit withdrawal despite an
  older saved instruction. Exact effects and actual replies were reviewed
  `Ready`. The withdrawal and two related repetition journeys passed against
  the final decision table.
- The dense withdrawal paragraph initially failed the live behavior test even
  though it was provider-visible. The final three-case table at the same skill
  owner resolves that case without a new state owner or tool guard.
- The test wrapper now preserves allowlisted structured failure categories and
  numeric/boolean diagnostics while omitting raw detail and identifiers.
  Four focused diagnostic tests and assistant-engine typecheck passed.
  Existing Frog issue 2695 covers the failure-reporting friction.
- Some retry attempts incorrectly used an environment variable discarded by
  the top-level live wrapper. They only proved default-profile rejection, not
  that every alternate profile failed. The documented `--codex-home` option
  selected a working subscription and completed the required journeys.
- Synthetic old/current compatibility proof passed six cases: canonical
  workout and CLI-result readers both accept omitted/numeric fields; old
  readers reject null and current readers preserve it. Existing full immediate
  release, member pinning, and write fences support separate old/new workspaces.
  A workspace's first null write establishes its compatible-reader rollback
  floor. Controlled production smoke remains a deployment gate.
- Parent and independent source review found no additional ownership or
  coupled-state issue. Historical omitted fields cannot reveal old withdrawals;
  this change preserves the distinction for new explicit clears. No production
  data was changed, and unavailable historical provider traces remain outside
  the claims of local proof.
- PR 3068 is published. The user authorized completing verification/review and
  merging. Complete provider-input measurement, final ReviewGPT, exact-head CI,
  plan closure, and merge through the existing completion owner without another
  merge approval request.
- Complete first-provider-request capture through real route processing and
  pinned Codex 0.153.4, using an isolated loopback Responses recorder: individual
  input is 27,653 to 27,763 o200k_base tokens (+110, +0.3978%) and 127,744 to
  128,213 UTF-8 bytes (+469); group input is unchanged at 23,627 tokens and
  107,861 bytes with an identical normalized request hash. Base is 583cfd8fbbb3,
  captured head is 1f6a6479d275; subsequent edits only affect proof and docs.
  Both fixtures pass at base and head. All request body fields, native tools,
  generated code-mode guidance, instructions, and messages are included;
  volatile ids, start time, and private paths are consistently normalized.
  Counts use locked gpt-tokenizer 3.4.0 with the published GPT-5 family mapping;
  transport/auth headers and unobservable provider framing/billing are excluded.
