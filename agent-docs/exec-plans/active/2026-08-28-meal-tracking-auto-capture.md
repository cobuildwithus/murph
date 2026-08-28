# Surface automatic meal capture on the first tracking request

Status: active
Created: 2026-08-28
Updated: 2026-08-28

## Goal

- When a person asks Murph how to track meals each day, the first private
  reply presents the existing iPhone automatic meal-capture path and canonical
  App Store handoff without requiring a follow-up that says "automatically."
- Keep manual text and photo logging available as the lower-tech alternative;
  do not add another intent system, product state owner, or setup effect.

## Success criteria

- The production skill router treats ordinary start/maintain meal-tracking
  requests as eligible for both `automatic-meal-capture` and `food-journal`.
- The automatic-capture skill tells Murph to lead with the compatible iPhone
  app option for a general recurring meal-tracking request and to present
  manual chat capture as an alternative, not the only path.
- Deterministic tests prove the composed production prompt has the required
  routing rule and no conflicting manual-only guidance.
- One focused production-derived real-Codex journey answers a synthetic private
  meal-tracking request with the automatic option, canonical App Store listing,
  honest device/background limits, and no product effects or canonical writes.
- The actual synthetic reply passes manual Product UX review as concise, warm,
  truthful, and complete.

## Scope

- In scope:
  - The Assistant Engine skill catalog, compact skill-router guidance,
    automatic-capture skill instructions, deterministic prompt proof, and one
    focused live assistant journey.
  - A member-visible changelog entry for the corrected first-answer behavior.
- Out of scope:
  - Changing automatic-capture enrollment, iOS behavior, Photos permissions,
    upload/import, daily closeout, canonical meal writes, or delivery.
  - Assuming every person has a compatible iPhone or removing manual meal
    logging.
  - Copying or paraphrasing confidential screenshots into repository artifacts.

## Constraints

- Technical constraints:
  - Reuse the existing two skills and canonical public App Store URL; add no
    runtime branch, state, route, tool, or dependency.
  - Keep the model responsible for natural phrasing while making the product
    priority explicit at the production prompt boundary.
- Product/process constraints:
  - Product UX Patch. Outcome: the first answer reveals the lowest-friction
    supported option. Reaches: a private member asking to begin recurring meal
    tracking. Proof: deterministic prompt composition plus the focused real
    assistant journey and reply review.
  - Walk both materially different people: a compatible-iPhone member who can
    take the app handoff, and a member who needs the manual chat alternative.
  - Preserve autonomy and avoid promising guaranteed background capture or
    historical photo scanning.

## Risks and mitigations

1. Risk: Murph may imply automatic capture works on every phone or is fully
   guaranteed in the background.
   Mitigation: Route through the existing owning skill, preserve its compatible
   iPhone and best-effort language, and assert forbidden universal claims.
2. Risk: A strong app handoff may crowd out the person's immediate manual
   option.
   Mitigation: Require a concise manual text/photo alternative in the same
   answer without making the person choose before receiving useful guidance.
3. Risk: Generic global wording may affect non-meal nutrition requests.
   Mitigation: Limit the new rule to starting or maintaining recurring meal
   tracking/capture and prove the exact composed route text.

## Tasks

1. Update the existing automatic-capture and food-journal routing boundary.
2. Strengthen deterministic prompt/skill tests for the generic recurring meal
   tracking entry.
3. Add and run one focused real-Codex private meal-tracking journey.
4. Complete the Product UX walkthrough, changelog, scoped verification, diff
   review, and privacy scan.
5. Commit, open a draft PR, run the prompt/Product UX/coverage preliminary
   ReviewGPT pass with exact-head CI, resolve accepted findings, and close the
   plan through the repository finish workflow.

## Decisions

- Treat this as a routing-priority defect in existing product behavior, not a
  new automatic-capture feature.
- Lead with the compatible iPhone automatic option on a general recurring
  tracking request because it is the lowest-burden supported path, then keep
  manual chat logging available.
- Scope direct journey proof to a synthetic private iMessage turn; no channel,
  permission, persistence, or effect owner changes. One safe read command loads
  both production skills before the reply; no dynamic tool is called.

## Verification

- Commands to run:
  - Focused Assistant Engine Vitest files covering the automatic-capture and
    food-journal prompt boundaries.
  - `pnpm test:assistant:live -- --test "offers automatic meal capture on the first recurring tracking request"`
  - The package/diff-aware focused verification and typecheck selected by the
    verification matrix.
  - `git diff --check` plus a final changed-file privacy scan.
- Expected outcomes:
  - All deterministic and focused package checks pass.
  - The selected live journey performs no product effects or canonical writes
    and prints a concise reply that includes the automatic iPhone app path,
    canonical App Store URL, truthful limits, and manual alternative on the
    first turn.
  - Product UX walkthrough verdict: Ready for both selected people.

- Evidence captured:
  - The two focused deterministic skill/prompt test files pass with 6 tests.
  - The production-derived real-Codex journey passes with `gpt-5.6-terra`
    through the authenticated local subscription. It reads both owning skills
    in one safe command, calls no dynamic tool, performs no canonical write,
    leads with compatible-iPhone automatic capture and the App Store handoff,
    states Full Photos plus best-effort background limits, and then offers
    manual text, photo, and voice-note capture.
  - Product UX walkthrough: Ready for the compatible-iPhone path and for the
    manual alternative when the app path is unavailable or unwanted.
  - Complete initial provider-input measurement used the scripted real Codex
    App Server boundary, identical synthetic direct/group requests, selected
    provider-visible `include`, `input`, `parallel_tool_calls`, `text`, and
    `tool_choice`, and `gpt-tokenizer` 3.4.0 `o200k_harmony`. Base was derived
    from each captured head request by removing only the new reviewed router
    line, so volatile runtime identifiers are identical. Direct changes from
    27,540 tokens / 125,765 bytes to 27,630 / 126,230 (+90, +0.3268%; +465,
    +0.3697%). Group changes from 23,100 tokens / 105,237 bytes to 23,190 /
    105,702 (+90, +0.3896%; +465, +0.4419%). The delta is confined to assembled
    instructions; deferred skill bodies and their broadened catalog hints are
    absent from the first provider request.
