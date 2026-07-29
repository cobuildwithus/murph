# Current local time in assistant context

## Outcome

Each hosted Murph turn receives Codex's native current-time reminder alongside
the existing local date and canonical timezone. When timing materially changes
an immediate suggestion, Murph uses that context for meals, sleep, caffeine, and
exercise instead of proposing something that no longer makes sense at that hour.

## Evidence

- Codex 0.145.0 already has a native `current_time_reminder` feature that emits
  `It is YYYY-MM-DD HH:MM:SS UTC.` as developer context before inference.
- The feature is disabled by default.
- The observed failure was a dinner suggestion around 23:00.

## Scope

- Enable the pinned Codex current-time reminder in hosted config, using the
  system clock and a bounded user/tool-output delivery cadence.
- Add one compact, stable decision rule for time-sensitive immediate advice.
- Add focused English regression tests.

## Non-goals

- No Murph-owned clock, tool, service, persisted state, scheduler, or timezone
  ownership.
- No fixed quiet-hours rule or blanket prohibition on late-night suggestions.
- No changes to reminder delivery or automation behavior.

## Verification

- Prompt/model-behavior proof: 73 passed. The generated-config suite passed
  40 tests with 2 unrelated opt-in lanes skipped; its enabled real-Codex lane
  passed 41 tests with 1 unrelated lane skipped.
- Pinned Codex 0.145.0 accepted the exact reminder table and injected its
  current-time developer message into a captured provider request.
- Identical provider-boundary fixtures measured +160 `o200k_base` tokens and
  +596 UTF-8 bytes for direct Murph, including the stable instruction and
  Codex-generated reminder. Group Murph receives only the native reminder:
  +37 tokens and +112 bytes.
- Product-experience review passed after the advice rule was gated to hosted
  runtime only.
- Preliminary ReviewGPT found that the personal-time rule must exclude
  synthetic group rooms and that the real-Codex test needed a provider-boundary
  reminder assertion; both findings are resolved with focused passing proof.
- Parent final review.
Status: completed
Updated: 2026-07-29
Completed: 2026-07-29
