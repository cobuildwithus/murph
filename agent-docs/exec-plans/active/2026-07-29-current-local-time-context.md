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

- Focused assistant-engine prompt and planning tests.
- Canonical `pnpm test:diff` for changed paths.
- Required prompt/coverage specialist review and product-experience review.
- Parent scope, diff, and regression review.
