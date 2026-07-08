# Challenge Selector Projections

Status: completed
Updated: 2026-07-07

## Why

PR #445 introduced selector-scoped `activity-minutes-days.v1` shares so group
challenges can request a narrow activity slice such as running minutes instead
of broad all-day activity minutes. The next useful extension should keep that
selector model narrow and consent-explicit rather than turning every metric into
a generic query language.

## Scope

- ReviewGPT recommended adding only two activity-session-derived selector scopes:
  `activity-distance-days.v1.activityKind.<kind>` and
  `activity-session-count-days.v1.activityKind.<kind>`.
- Extend the existing vault-share projection-scope primitive for those two
  consent-explicit challenge primitives.
- Keep activity-session-derived scopes separate from whole-day physiology
  metrics.
- Keep projection records bounded, deterministic, and parseable through the
  existing hosted-execution vault-share contract.
- Update the hosted runtime projector, destination import/read model, group
  join display, CLI filters, and focused tests for any new scope.
- Keep join-page accept payload bounds large enough for the expanded closed
  selectable scope set while still rejecting large request bodies.

## Non-goals

- No open-ended metric query DSL.
- No new persisted state owner beyond the existing shared projection store.
- No broad challenge scoring engine or leaderboard abstraction.
- No selectors for naturally whole-day/current-state metrics such as sleep,
  HRV, resting heart rate, strain, VO2 max, or steps.

## Verification Plan

- Focused hosted-execution vault-share contract tests.
- Focused assistant-runtime vault-share projection/import tests.
- Focused CLI group shared tests.
- Focused hosted web group/join/vault-share tests as needed.
- `pnpm typecheck` or the highest truthful scoped verification lane available.

## Deployment Notes

This likely spans web, hosted-execution contracts, assistant-runtime runner code,
and CLI. Keep additive/backward-compatible parsing for existing fixed-kind
requests and existing stored projection records. The new scope must degrade to
empty/no data when old members have not granted it, not expose broader data.
Completed: 2026-07-07
