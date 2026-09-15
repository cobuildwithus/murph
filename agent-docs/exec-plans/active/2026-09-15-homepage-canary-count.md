# Exclude canary traffic from public message totals

Status: active
Created: 2026-09-15
Updated: 2026-09-15

## Outcome

The homepage count excludes configured Linq canary traffic and retains ordinary
messages, including other chats on the same Murph sending line.

## Evidence and architecture

The public total sums daily snapshots and live records. Snapshot capture already
excludes the canary member and current/pending chat keys; the live reader omits
those filters. Share the existing three message-count queries between both
callers within the Growth owner. Keep canonical identity/routing attribution,
snapshot boundaries, successful-send statuses, anonymous Telegram/email receipts,
and the existing base fallback. Add no persisted state or dependency.

## Product UX

- Outcome: restore accurate public message activity.
- Reaches: homepage visitors and all existing public-total consumers.
- Proof: API response/filter tests and real PostgreSQL canary/ordinary traffic,
  plus missing-canary and failed-read fallback coverage. Presentation is unchanged.

## Tasks

1. Consolidate filtered message reads and reuse them for the public live total.
2. Add regression proof; run focused tests, Web typecheck and complexity guard.
3. Review, commit, open the PR, run ReviewGPT alongside CI, and merge after gates.

## Risks and deployment

Read-only Web change with unchanged schema and API shape. Existing daily
snapshots remain immutable; no speculative historical adjustment is introduced.
Old Web instances retain the old live behavior until replaced. Existing public
cache headers may briefly retain a pre-deploy total. No Worker rollout dependency.

## Verification

- Passed: Growth tests (63), dedicated local PostgreSQL canary proof (1),
  changelog renderer tests (10), focused ESLint, and complexity guard (no hotspots).
- Initial proof setup failures: missing generated changelog input and an empty
  local test database. Generated the existing input and applied existing migrations
  to a dedicated task database; both checks then passed.
- Web typecheck and exact-head CI remain pending.
- Parent review: shared queries retain ordinary same-line traffic, anonymous
  receipts, successful-send status filters, snapshot windows, and base fallback.
  No personal identifiers or production data were added.
