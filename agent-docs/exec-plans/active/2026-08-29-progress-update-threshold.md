# Progress Update Threshold

Status: active
Created: 2026-08-29
Updated: 2026-08-29

## Goal

Make member-visible progress updates less eager: routine conversation,
onboarding, and ordinary context checks should answer directly, while genuinely
long reply-critical work can still send one useful update.

## Product UX Patch

- Outcome: members no longer receive an unnecessary interim bubble before a
  simple onboarding or conversational answer.
- Reaches: ordinary private hosted turns that compose the shared progress
  guidance, including onboarding turns.
- Proof: deterministic composed-prompt coverage plus one focused real-Terra
  onboarding journey with zero progress calls and a direct useful reply.

## Architecture

- Keep `murph.send_progress_update` and its existing delivery owner unchanged.
- Tighten the shared prompt decision rule at its current owner rather than add
  state, routing, tool variants, or onboarding-specific machinery.
- Preserve explicit skill-owned acknowledgements for genuinely slow work such
  as accepted lab-document processing.

## Verification

- Focused deterministic assistant prompt and behavior tests.
- Focused real-Codex journey using the production prompt and tool contracts.
- Complete normalized direct/group first-provider request measurement through
  the pinned real Codex App Server and hermetic Responses stub.
- Preliminary Product UX and prompt ReviewGPT lenses on the exact PR head.

## Progress

- Root cause traced to permissive shared progress guidance combined with a
  multi-message onboarding turn.
- The shared rule now reserves progress for genuinely noticeable waits, while
  the onboarding reference defers to that owner and only clarifies the local
  non-trigger.
- Deterministic coverage passed (104 assertions, 7 skipped), Assistant Engine
  typecheck passed, and the focused real `gpt-5.6-terra` onboarding journey
  returned a useful direct answer with zero progress calls.
- Normalized complete initial provider input grows by 4 `o200k_harmony` tokens
  and 55 UTF-8 bytes for the direct route; the group route is unchanged.
- A positive target-model regression exposed an overcorrection: a five-command,
  39-second recovery analysis stayed silent. The shared rule now uses the
  simpler observable boundary of three substantive reply-dependent actions,
  while retaining the explicit onboarding and one-or-two-quick-call exclusions.
- The final target-model pair passed: the substantive recovery analysis sent
  exactly one early update, while the simple onboarding next-step sent none and
  answered directly with one useful question.
- Changelog rendering tests (9 assertions) and the hosted Web typecheck passed.
