# Nutrition Card Legacy Calorie Compatibility

Status: completed
Created: 2026-08-20
Updated: 2026-08-21

## Goal

Let an existing accepted daily calorie target stored under the legacy
`calories` metric qualify for the same nutrition card as the canonical
`dietary-calories` metric, without rewriting member state or weakening the
card's safety gate.

## Production Evidence

- An explicit daily-card request had complete same-day meal totals after one
  requested estimate was saved.
- The accepted active goal contained exact calorie, macro, and fiber targets,
  but its calorie target used the older `calories` metric key.
- Current card instructions accept only `dietary-calories`, so the otherwise
  complete target bundle was rejected.
- The interactive evidence pass sent an interim status message and produced a
  large tool-output payload before the final eligibility decision, creating a
  fragmented and frustrating conversation.

## Product UX Patch

### Outcome

Members with an older accepted calorie target can receive the same daily
nutrition card as members with a newly authored canonical target. A routine
fast card request resolves end to end in one response. If the same bounded
workflow is genuinely delayed, Murph may send one brief outcome-oriented
acknowledgement without narrating the internal preflight, then returns one card
or concise fallback.

### Reaches

- Existing members whose active point calorie target is stored as `calories`
  in `kcal`.
- Members whose equivalent target is already stored as
  `dietary-calories`.
- Interactive card requests and managed meal closeouts.
- Members whose safety evidence or target bundle is incomplete, conflicting,
  out of window, or incompatible; these paths must remain text-only and
  fail-closed.

### Proof

- Skill and tool-contract tests prove the narrow legacy alias, canonical
  preference, conflict handling, and future canonical authoring.
- A mapping regression proves a legacy calorie target produces the canonical
  calorie card snapshot while incompatible units and comparators remain
  rejected.
- Prompt-contract coverage proves fast daily-card fulfillment skips progress,
  while a delayed production-shaped pass sends one non-technical update before
  30 seconds and preserves the final card or truthful fallback.

## Constraints

- Add no new state owner and do not mutate or duplicate an existing Goal only
  to repair its metric key.
- Treat `calories` as a read-only compatibility alias only for the daily-card
  calorie slot. New target authoring remains `dietary-calories`.
- Prefer the canonical target when both aliases represent the same exact point.
  Treat differing applicable values as a conflict and attach no card.
- Keep every current safety read and suppression boundary fail-closed.
- Do not copy private conversation wording or identifying evidence into tests,
  docs, changelog content, or review artifacts.

## Tasks

1. Update the nutrition-card goal, safety, meal-closeout, food-journal, and
   response-card tool contracts with one consistent legacy-alias rule.
2. Keep fast card fulfillment to one final response and allow at most one
   outcome-oriented acknowledgement only when the bounded pass will keep the
   member waiting.
3. Add focused regression coverage for legacy mapping and prompt behavior.
4. Add a member-facing changelog item, run focused verification and typecheck,
   then complete the exact-head review, CI, commit, and PR workflow.

## Verification

- Focused assistant-engine Vitest files for nutrition strategy, automatic meal
  capture, food journal, response-card tool descriptions, and scripted runtime.
- Assistant-engine typecheck and `git diff --check`.
- Required exact-head preliminary specialist review and GitHub checks.

## Product UX Walkthrough

- Existing legacy target: a member with one applicable exact-point `calories`
  target in `kcal` and the four canonical gram targets reaches the existing
  nutrition card without target repair. The mapping regression resolves the
  legacy value into the calorie card snapshot, and the prompt contract keeps
  new authoring canonical.
- Canonical target: a member with `dietary-calories` keeps that owner. An
  identical legacy alias is ignored; a different value, incompatible alias,
  or multiple legacy-only owners remains a conflict with no Goal mutation and
  no card.
- Routine interactive request: the card workflow completes its meal estimate,
  totals, safety, and target checks before the final response. Food-journal and
  response-card contracts prohibit narrating those mechanics. The fast-path
  production case sends no progress; a controlled delayed pass with six benign
  conditions and six benign regimens accepts one outcome-oriented update before
  30 seconds, then reaches the card in the same turn.
- Safety or data failure: one exact generic-read fallback may recover a failed
  or truncated condition or regimen detail. An incomplete or ambiguous
  fallback remains fail-closed; no fields or records are omitted.
- Difference from plan: final ReviewGPT round 1 found that absolute progress
  suppression could leave a delayed request silent and that the resident tool
  description duplicated its compatibility rules. The remediation reuses the
  existing direct-turn progress owner only for delayed work and folds each rule
  into its existing clause. The walkthrough is `Ready`; it adds no audience,
  state owner, or delivery path.

## ReviewGPT Round 2 Retrospective

- Trigger: the same compatibility-at-one-layer failure repeated when target
  authority accepted the legacy calorie owner but later attachment still
  restated a canonical-only eligibility rule.
- Requirement decision: a resolved compatible legacy `calories`/`kcal` owner
  authorizes every normal daily-card attachment path, including a later request
  after managed macro and fiber proposal activation supplies the missing slots.
- Shape decision: target-authority is the single eligibility owner. Proposal
  activation and later card attachment consume its resolved complete bundle
  directly instead of rechecking accepted metric keys downstream.
- Complexity disposition: delete duplicated eligibility policy; do not add a
  new exception, prompt overlay, state owner, lifecycle, or Goal repair path.
- Proof: prompt-contract tests assert the stale canonical-only gates are absent,
  and scripted runtime coverage exercises legacy calorie plus managed macro and
  fiber activation, later card delivery, conflict rejection, and no legacy Goal
  mutation.

## ReviewGPT Round 3 Outcome

- ReviewGPT completed a full-patch audit of source head
  `585bc2090621f8c2a322adb5c58f53bcdaf60f69` and returned
  `ROUND_OUTCOME: PASS` with no qualifying finding or patch.
- The audit rechecked the resolved round 1 progress/duplication findings and the
  round 2 split-eligibility finding. No additional remediation was required.
- The reviewer noted that no separate rendered screenshot or DOM artifact was
  attached for the changelog entry, so the pass did not independently assess
  its visual hierarchy, wrapping, or accessibility.

## Provider Input Measurement

- A pinned real Codex App Server and local scripted Responses endpoint captured
  normalized complete first provider-visible inputs for synthetic private and
  group card turns. The base was derived from each captured head request by
  removing only the new compatibility fragment, keeping the fixture and every
  other serialized field identical.
- With `gpt-tokenizer` 3.4.0 `o200k_harmony`, the private request changes from
  15,879 tokens / 71,241 UTF-8 bytes to 16,049 / 72,106 (+170 tokens,
  +1.0706%; +865 bytes). This is 45 tokens / 274 bytes smaller than the first
  reviewed version. The group request remains 14,187 tokens / 61,593 bytes.
  Captured fields were `include`, `input`, `instructions`,
  `parallel_tool_calls`, `text`, `tool_choice`, and `tools` when present;
  model selection, reasoning, storage, streaming, service tier, cache/client
  metadata, and transport headers were excluded identically. Temporary paths
  and generated UUIDs were normalized.
Completed: 2026-08-21
