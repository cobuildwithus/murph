# Give push-primary sources a recovery lever

Status: completed
Created: 2026-07-24

## Why

Detecting a dead push carrier is only half the problem. Once a Garmin
connection stops receiving, nothing we already had could restart it: there is no
REST pull, and Junction's Refresh User Data cannot make Garmin push again. The
only recorded recovery was a manual disconnect and full re-authorization, which
is a bad enough experience that we would rather leave data broken than ship it.

Junction does expose a lever that needs no member action:
`POST /v2/link/bulk_trigger_historical_pull`, whose supported-provider enum
explicitly includes `garmin`. It re-runs the provider's historical pull, which is
the same mechanism that recovered the missing window when a connection was
manually reconnected. It ships under Link Migration, which is disabled per team
by default, so it must be enabled by Junction support before it can do anything.

## Change

- `JunctionClient.bulkTriggerHistoricalPull` — provider-scoped trigger for one
  or more Junction users. A gated 403/404 returns `endpointUnavailable` instead
  of throwing, because "not enabled for this team" is not a transport failure.
- Two operator recovery actions through the existing provider diagnostics seam:
  `refresh` (already implemented but unreachable) and `trigger_historical_pull`.
- `POST /api/ops/device-sync/junction-recovery`, reusing the existing hosted-ops
  access check, diagnostic connection resolution, and response redaction.

## Automatic recovery

The scheduled pass that detects a stall derives a bounded recovery attempt from
connection metadata, so a member never has to notice or act. The ladder is
episode-scoped on `silentSinceAt`: attempts at detection, +6h, and +24h, then
stop. A gated endpoint records `unavailable` and stops immediately, because
nothing local can enable it and retrying is pure noise. A source that recovers
and later stalls again starts a fresh ladder with no reset step. At most one
source per connection is triggered per pass.

The ops route remains for operator-driven one-off triggers and for exercising
`refresh`, which is also how we will confirm the lever works the first time.

## Deliberately not included

A source-scoped disconnect is also out of scope. `revokeAccess` deregisters every
provider slug on the Junction user, which is correct for its only caller (whole
connection disconnect). Resetting a single source is a new member-facing flow
that needs its own design, not a widening of the disconnect path.

## Invariants

- The recovery route is admin-allowlisted, same-origin protected, and
  feature-flag gated exactly like the existing Junction diagnostic route.
- Action validation happens before any provider call, so an unsupported action
  cannot reach a member's connection.
- Provider responses stay redacted by the device-sync diagnostics owner; the ops
  layer adds no new payload path.
- A gated endpoint is reported distinctly from a failure so an operator can tell
  "not enabled yet" from "tried and broke".

## Verification

- `pnpm --dir packages/device-syncd test` and the hosted ops route suite.
- Focused coverage: trigger request shape and user-id de-duplication, gated
  403/404 mapped to `endpointUnavailable`, real failures still thrown, invalid
  input rejected before any request, and the ops route surfacing all three
  outcomes.
- `pnpm test:diff` for every touched owner.
Updated: 2026-07-24
Completed: 2026-07-24
