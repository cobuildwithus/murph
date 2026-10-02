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
- [x] Distinguish missing inventory from absent timestamps and probe the bounded historical range across activity, sleep, and workouts.
- [x] Give canonical ingestion enough time to observe the ordinary fifteen-minute empty-history retry, preserving shorter authorization limits.
- [x] Refresh the controller installation token throughout the extended wait before enabling the private deadline.
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


The extended controller wait can exceed the one-hour installation-token lifetime.
A focused fake-clock regression reproduces authentication failure before an exact
successful receipt at minute sixty-two. Reuse the existing GitHub App token
supplier for each private request, preserving the same run, digest, repository
scope, and non-canceling cleanup owner. The public workflow supplies the same
protected App credentials to that supplier instead of minting one static token.
The public correction passed final review and exact-head CI in PR #3960 before
the private deadline activated in Murph Cloud PR #176, whose review and CI gates
also passed.

## Latest hosted evidence

The protected run completed the full twenty-minute provider-data wait. Real
authorization, persisted connection reload, browser disconnect, and cleanup
worked. The strict canonical proof failed because the provider returned no
eligible records. Bounded diagnostics also found empty activity, sleep, and
workout summaries across the ninety-day historical range. All three resource
inventory entries were present and their historical pull status was successful;
none had a newest-data timestamp. Historical completion therefore still does
not establish actual delivery. No credentials, member identifiers, or health
values belong in this record.

Evidence: [public run](https://github.com/cobuildwithus/murph/actions/runs/36917945131)
and [private run](https://github.com/cobuildwithus/murph-cloud/actions/runs/36917996960).
The data wait and controller changes are delivered; live ingestion remains
unqualified. The missing local webhook receiver cannot by itself explain empty
upstream reads. Do not weaken the oracle or infer that a production vault is
empty from this separate sandbox connection.

The intended data-bearing login has been confirmed and reapplied to the private
canary environment. A fresh hosted run is pending. Its persistent browser can
reuse a prior Garmin session, so refreshed secrets alone do not prove account
identity. Check that boundary before treating account selection as resolved. A read-only Opus 5.5 consultation
reached the same ordering; longer asynchronous delivery remains an unproven
alternative. Preserve the current cleanup contract unless a separately scoped
bounded delayed-delivery probe is justified.

## Historical diagnostics follow-up

Extend the existing failure-only introspection summary with closed categories
for the requested history range relative to the oracle window and whether the
provider reports any days with data. Reuse already-fetched metadata, adding no
requests, persisted state, provider mutation, or timeout. Historical range
overlap and reported data are diagnostic only; neither can satisfy the strict
canonical-value proof. Verify missing, malformed, disjoint and overlapping
ranges, zero/positive/unknown counts, identity isolation, and output privacy.


## Fresh authentication and permission diagnosis

Fresh provider browsers are now merged and live authorization succeeds without
restored cookies. A complete twenty-minute attempt still found no activity,
sleep, or workout summaries in the bounded historical range. Historical requests
overlapped the proof window and reported success with no days containing data;
cleanup succeeded. This establishes neither a production-vault failure nor the
cause of missing canary data.

The next bounded diagnostic uses the existing user-connections API to distinguish
resource authorization and required-scope denial from resource inventory. It runs
only after proof failure, uses the same user identity, adds one read within the
existing ten-second diagnostic limit, and emits only closed categories. No raw
scope names, provider IDs, health values, credentials, or errors are logged.

- [x] Verify permission classification, privacy, cancellation, and unchanged strict oracle.
- [ ] Complete focused typecheck, parent review, final review, and exact-head CI.
- [ ] Inspect a protected-main run with permission diagnostics before deciding on a correction.
