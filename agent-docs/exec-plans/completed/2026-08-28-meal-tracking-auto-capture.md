# Surface automatic meal capture on the first tracking request

Status: completed
Created: 2026-08-28
Updated: 2026-08-28

## Goal

- When a person asks Murph how to track meals each day, the first private
  reply presents the existing iPhone automatic meal-capture path and canonical
  App Store handoff without requiring a follow-up that says "automatically."
- Keep manual text and photo logging available as the lower-tech alternative;
  do not add another intent system, product state owner, or setup effect.

## Success criteria

- The production skill router treats ordinary private requests to start meal
  tracking as eligible for both `automatic-meal-capture` and `food-journal`.
- The automatic-capture skill tells Murph to lead with the compatible iPhone
  app option when known context does not establish an incompatible device,
  manual-only preference, or already-completed setup, and to present manual
  chat capture as an alternative rather than the only path.
- Deterministic tests prove the composed production prompt has the required
  routing rule and no conflicting manual-only guidance.
- Focused production-derived real-Codex journeys prove the ordinary private
  request plus the Android/manual-preference, already-enabled, and group
  boundaries, with no product effects or canonical writes.
- The actual synthetic reply passes manual Product UX review as concise, warm,
  truthful, and complete.

## Scope

- In scope:
  - The Assistant Engine skill catalog, compact skill-router guidance,
    automatic-capture skill instructions, deterministic prompt proof, and one
    focused live assistant journeys.
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
  - Walk a compatible-iPhone member who can take the app handoff, an
    Android/manual-preference member, a member whose setup is already complete,
    and a group conversation.
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
3. Risk: Generic global wording may affect established manual workflows or
   group conversations.
   Mitigation: Keep the compact route private/direct and start-oriented, leave
   answer policy in the automatic-capture owner, and prove the context and group
   boundaries deterministically and with real model journeys.

## Tasks

1. Update the existing automatic-capture and food-journal routing boundary.
2. Strengthen deterministic prompt/skill tests for the generic recurring meal
   tracking entry.
3. Add and run focused real-Codex meal-tracking journeys for the default and
   context-sensitive boundaries.
4. Complete the Product UX walkthrough, changelog, scoped verification, diff
   review, and privacy scan.
5. Commit, open a draft PR, run the prompt/Product UX/coverage preliminary
   ReviewGPT pass with exact-head CI, resolve accepted findings, and close the
   plan through the repository finish workflow.

## Decisions

- Treat this as a routing-priority defect in existing product behavior, not a
  new automatic-capture feature.
- Lead with the compatible iPhone automatic option on a private request to
  start recurring tracking when known context supports it, then keep manual
  chat logging available. Lead manual for known Android/manual preference,
  avoid repeated setup when already enabled, and do not introduce app setup in
  a generic group request.
- Scope direct journey proof to a synthetic private iMessage turn; no channel,
  permission, persistence, or effect owner changes. One safe read command loads
  both production skills before the reply; no dynamic tool is called.

## Verification

- Commands to run:
  - Focused Assistant Engine Vitest files covering the automatic-capture and
    food-journal prompt boundaries.
  - `pnpm test:assistant:live -- --test "real Codex recurring meal-tracking setup e2e"`
  - The package/diff-aware focused verification and typecheck selected by the
    verification matrix.
  - `git diff --check` plus a final changed-file privacy scan.
- Expected outcomes:
  - All deterministic and focused package checks pass.
  - The selected live journey performs no product effects or canonical writes
    and prints a concise reply that includes the automatic iPhone app path,
    canonical App Store URL, truthful limits, and manual alternative on the
    first turn.
  - Product UX walkthrough verdict: Ready for all selected contexts.

- Evidence captured:
  - The focused deterministic skill/prompt and controlled-ordering tests pass
    with 7 tests.
  - The production-derived real-Codex journeys pass with `gpt-5.6-terra`
    through the authenticated local subscription. The default private reply
    leads with compatible-iPhone automatic capture and the App Store handoff,
    states Full Photos plus best-effort background limits, and then offers
    manual text, photo, and voice-note capture. The context suite leads manual
    for Android/manual preference, avoids reinstall/setup guidance when capture
    is already enabled, and keeps a generic group reply app-free. The journeys
    call no dynamic tool and perform no canonical mutation.
  - Product UX walkthrough: Ready for the compatible-iPhone, Android/manual,
    already-enabled, and group paths.
  - The specialist preliminary pass returned three accepted findings: scope the
    generic route to private start intent and known context, make the live
    ordering assertion automatic-specific with a controlled negative case, and
    leave response policy in the owning skill instead of duplicating it in the
    router and food-journal handoff. The remediation implements all three and
    adds live Android/manual, already-enabled, and group coverage.
  - The final provider-input measurement used the scripted real Codex App
    Server boundary with representative direct/group initial requests, selected
    provider-visible `include`, `input`, `parallel_tool_calls`, `text`, and
    `tool_choice`, and `gpt-tokenizer` 3.4.0 `o200k_harmony`. Base was derived
    from each captured head request by removing only the new reviewed router
    line in the same serialized direct request; the line is absent from the
    group request. Direct changes from 27,688 tokens / 125,669 bytes to 27,734 /
    125,882 (+46, +0.1661%; +213, +0.1695%). Group stays unchanged at 27,599
    tokens / 125,934 bytes. The temporary capture hook and files were removed.
    The delta is confined to assembled private instructions; deferred skill
    bodies and their broadened catalog hints are absent from the first provider
    request.
Completed: 2026-08-28
