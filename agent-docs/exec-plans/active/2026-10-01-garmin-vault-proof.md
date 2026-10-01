# Require real Garmin data in the canary vault

Status: active
Created: 2026-10-01
Updated: 2026-10-01

## Goal

A successful Garmin canary must prove real provider data reached its canonical
vault through the ordinary hosted sync path, followed by successful cleanup.

## Scope and ownership

Public Murph owns the bounded provider-to-vault comparison. Murph Cloud consumes
its private receipt and owns hosted execution and final attestation. Change the
producer first, then reject empty-data receipts in the consumer. No production
member mutations, synthetic live samples, or forced processing shortcuts.
Native email canary work continues separately in its existing PRs.

## Tasks

- [x] Poll through initially empty provider responses and fail at the deadline.
- [x] Reject empty-data success in the private receipt consumer.
- [x] Verify the original receipt changes with regression tests, typechecks, required review and exact-head CI.
- [x] Verify bounded provider diagnostics for an unsuccessful live data proof.
- [x] Verify the provider query includes the entire final closed calendar day.
- [ ] Distinguish missing inventory from absent timestamps and probe the bounded historical range across activity, sleep, and workouts.
- [ ] Give canonical ingestion enough time to observe the ordinary fifteen-minute empty-history retry, preserving shorter authorization limits.
- [ ] Run the hosted canary and require canonical ingestion plus cleanup.

## Evidence and risks

The producer now polls empty responses and the consumer rejects empty-data
receipts. Both changes are merged. The hosted proof remains unqualified;
connection and cleanup alone do not establish canonical ingestion.
The oracle requires positive steps on a completed day in its bounded window;
recent open-day data cannot safely support exact-value equality.

The next diagnostic reads account-scoped resource availability and historical
pull status only after the data deadline. Its output uses closed resource,
window-relative availability, and status categories. A ten-second bound fits
inside the existing browser cleanup grace period. It cannot certify ingestion,
change the proof result, or log provider payloads, dates, IDs, or health values.

A client-level regression reproduced the canary's end-date truncation: the
inclusive final day was transmitted as midnight at the beginning of that day.
Use an explicit end-of-day instant while preserving the same closed-day window
and exact canonical-value comparison. The request-boundary correction is merged
and verified, but the live query still returned no records in its selected window.

The next diagnostic keeps the ten-second total deadline while probing three
summary resources over the provider's default ninety-day historical range.
Only closed availability categories leave the process. It distinguishes missing
inventory owners from missing timestamps; diagnostic records cannot pass the
canonical proof.

The isolated canary has no configured Junction webhook receiver and relies on
the ordinary historical retry path. That path first retries empty history after
fifteen minutes; the existing seven-minute data deadline cannot observe it.
Public Murph will support a separate bounded data deadline and retain the
browser session through that deadline and cleanup. Land the public support and
controller timeout first, then configure twenty minutes for data in Murph Cloud
and extend its outer runner limit. No production scheduling, webhook targets,
or member state changes are required.

## Verification

Focused live-data oracle tests, private receipt CLI tests, relevant typecheck,
and a fresh protected-main hosted run. Publish only metadata, never health
values, dates, provider credentials or account identifiers.
