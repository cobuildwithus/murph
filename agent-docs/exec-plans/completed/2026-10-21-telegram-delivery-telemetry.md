# Telegram text acceptance telemetry

Status: completed
Created: 2026-10-21
Updated: 2026-10-21

## Goal and evidence

The text adapter discards Telegram Message.date, leaving operators unable to
compare provider send time with local completion. Capture that evidence without
claiming device delivery or changing scheduling, receipt semantics, or retries.

## Ownership and scope

The engine observes the already parsed sendMessage response. The hosted callback
projects content-free metadata into the existing bounded runtime log queue,
correlated through its existing outbox intent reference. No new persisted schema,
receipt field, store, dependency, or awaited diagnostic call is needed.
Scope is hosted outbox text sends; rich/media telemetry is excluded.

## Failure and deployment

Observer failures and pending promises must never change send results or trigger
retries. Missing or invalid provider dates remain unknown. Existing receipts stay
byte-shape compatible; old runners simply omit the new diagnostic event. Rollback
needs no data migration. The closed log event enum requires consumer-first Web
release and producer drain before rollback below that consumer. Normal protocol
admission enforces this boundary. Existing retention and queue bounds apply.
Provider acceptance does not establish device visibility or a read receipt.

## Tasks and proof

1. Add a nonblocking text acceptance observer and wire it to hosted outbox logs.
2. Test provider timestamps, missing/invalid metadata, chunk/retry behavior,
   failing/stalled observers, privacy projection, and the actual hosted adapter.
3. Run affected tests/typechecks, complexity and documentation checks; review diff.
4. Commit, open PR, run required ReviewGPT concurrently with CI, and merge.

## Verification

Implementation and parent diff review complete. Focused proof passed:

- Engine channel runtime and text telemetry: 115 tests.
- Hosted callback integration: 315 tests, including the actual text adapter,
  bounded deferred log queue, strict ingestion parser, and privacy projection.
- Shared log contracts: 4 tests.
- Cloudflare deployment admission: 30 tests; served Web admission: 6 tests.
- Assistant Engine, Assistant Runtime, and Hosted Execution package typechecks.
- Runtime dependency build, complexity guard (unchanged debt), raw-log privacy
  guard, documentation drift/gardening, and whitespace checks.

Web proof required generating the fresh checkout's Prisma client first.
Internal telemetry needs no public changelog or live-model journey because prompts
and member behavior are unchanged. PR review and required CI remain shipping gates.
Existing complexity hotspots are unchanged; extracting unrelated delivery logic
would expand scope without improving this metadata-only correction.
Completed: 2026-10-21
