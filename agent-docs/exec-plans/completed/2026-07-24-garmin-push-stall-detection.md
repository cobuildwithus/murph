# Detect silent push-primary source stalls

Status: completed
Created: 2026-07-24

## Why

Garmin reaches us only through Junction's push carrier. When Garmin's push
service stops sending for one connection, nothing in the system can tell.
Junction keeps reporting the connection as `connected` with every resource
`available`, so the provider list is identical for a healthy source and a dead
one. Our hourly reconcile pulls a window Junction cannot fill, gets zero rows,
and records an ordinary success.

Production evidence on 2026-07-24: of ten active Garmin connections, four had
received no inbound data event for over 24 hours, two of them for 3.8 and 6.8
days. One connection emitted its opening burst at connect time and nothing in
the 27 hours since. The only reason any of this surfaced was a member noticing
missing data and a manual vendor support thread.

The gap is that we never record when a *source* last delivered data:

- `device_connection_source.last_seen_at` is stamped `context.now` on every
  reconcile, so it means "Junction still lists this source", not "data arrived".
- `device_observation_state.last_webhook_at` is connection-scoped, so a live
  sibling source on the same Junction connection masks a dead one completely.

## Change

Record per-source data arrival and evaluate it on the existing hourly pass.

- Add `last_data_at` to `device_connection_source` (local SQLite and the hosted
  Postgres projection), stamped only when an inbound webhook carries that
  source's data.
- Add a pure staleness evaluator in `packages/device-syncd` that flags a
  push-primary source whose `last_data_at` (or `first_seen_at`, for a source
  that never delivered) is older than its threshold.
- Emit one `device-sync.source_stalled` hosted runtime log event per stale
  source from the existing device-sync maintenance pass, under the existing
  event cooldown.

## Invariants

- `last_seen_at` keeps its current meaning and its ordering index; the new
  column is the only data-arrival signal and never gates ingestion.
- Staleness is observation only. It does not change source `status`, does not
  set `last_error_code`, does not disconnect, and does not surface
  member-facing reconnect copy. Recovery is a separate change.
- The ingress stamp follows the existing `markWebhookReceived` contract: it runs
  after durable acceptance and a failure is logged, never fatal to the webhook.
- Push-primary thresholds are provider policy, not per-member state. No new
  table, queue, scheduler, or state owner.
- A connection with no `last_data_at` yet is evaluated from `first_seen_at`, so
  a connect that never streams is caught by the same rule.

## Verification

- `pnpm --dir packages/device-syncd typecheck` + package tests.
- Focused coverage: ingress stamps only the delivering source; reconcile does
  not stamp; evaluator flags never-delivered and gone-quiet sources and ignores
  pull-capable ones; hydration round-trips the new field both directions.
- `pnpm test:diff` for every touched owner.

## Verification results

- `pnpm --dir packages/device-syncd test` — 43 files, 840 tests pass.
- `pnpm --dir packages/assistant-runtime` maintenance suite — 73 tests pass,
  including the stalled-source report and the pass-survives-reporting-failure
  case.
- `pnpm test:diff` — green across every affected package typecheck, package
  test, and app verification lane.
Completed: 2026-07-24
Updated: 2026-07-24
Completed: 2026-07-24
Completed: 2026-07-24
Completed: 2026-07-24
