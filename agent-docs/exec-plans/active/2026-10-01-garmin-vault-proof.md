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
- [ ] Verify regression tests, typechecks, required review and exact-head CI.
- [ ] Run the hosted canary and require canonical ingestion plus cleanup.

## Evidence and risks

Current producer returns immediately for an empty provider response; the current
consumer accepts that limited outcome as a successful job. The latest scheduled
run failed during PostgreSQL image download before reaching provider work.
The oracle requires positive steps on a completed day in its bounded window;
recent open-day data cannot safely support exact-value equality.

## Verification

Focused live-data oracle tests, private receipt CLI tests, relevant typecheck,
and a fresh protected-main hosted run. Publish only metadata, never health
values, dates, provider credentials or account identifiers.
