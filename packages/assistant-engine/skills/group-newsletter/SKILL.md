---
name: group-newsletter
description: |
  Public consent, recipient, data-coverage, delivery, and retry contract for a
  recurring Murph group health newsletter in the current chat or by consented
  group email. Read during setup and every scheduled group-health-newsletter
  run. Hosted Murph replaces this baseline with its complete first-party
  editorial behavior during the private runner build.
---

<!-- murph-public-group-skill-baseline:v1 -->

# Group Newsletter Contract Baseline

Read `group-chat` alongside this skill. `group-chat` owns room behavior,
configuration authorization, email consent offers, and self-owned opt-out.
This skill owns only the data and delivery contract for a configured run.

## Configuration

Keep one canonical `group-health-newsletter` automation bound to its exact group
route. Create or replace it only through
`murph.automation action="save_newsletter"` with the complete newsletter name,
schedule, delivery mode, tone, health scopes, and optional note. Do not hand-
author a reserved slug or generic instructions. Stop or resume only through the
existing status mutation owned by `group-chat`.

Current-chat delivery may select at most three health scopes and does not require
`group-email.v0`. Group-email delivery requires the current exact email grant and
may use only the supported scopes recorded in the canonical configuration.

## Data source

Follow the trusted scheduled execution contract. Do not use conversation memory,
generic knowledge, raw `vault-share/**`, legacy projections, private one-to-one
records, provider traces, or another tool as alternate health-data sources.

For `group_email`:

1. Call `murph.newsletter` with `action="prepare"` and no model-supplied group or
   route id.
2. Use only the returned currently eligible `members`, `referenceAt`, and bounded
   completed-day `weeklyStats`.
3. Compose one subject, HTML body, and equivalent text body.
4. Call `murph.newsletter` with `action="send"` once and no model-supplied group
   or route id.

If prepare is unavailable, invalid, or has no `referenceAt`, stop without
composing or sending and return a skip notification decision with a factual
private summary. If grants, membership, route, or eligibility change before
send, the owning tool fails closed.

For `current_chat`, do not call `murph.newsletter`. Call
`murph.group action="read_shared"` once for the exact saved scopes, use only the
currently granted facts, apply `group-chat`'s **Shared fact limits**, and return
one concise `send_message` edition to the bound route.

## Coverage and comparison

Use only usable completed dates. Email uses each stat's `observedDates` and
`throughDate`. Current chat uses records dated within the seven local calendar
days before today and valid under the projection contract. Exclude today and
anything older than that rolling window.

State the date scope for each average. Declare a settled cross-person leader,
winner, or crown only when every compared date set is identical. When coverage
differs, report scoped values or an unranked pattern. Never treat an unobserved
day as zero, imply a partial week is complete, or use a current/provisional value
as settled.

Keep distinct measures separate. A broad activity-minute average may be phrased
as about 30 minutes of movement a day only when the returned value and date
coverage prove that exact statement. Keep them separate from workouts, steps,
sleep, and other metrics. Do not use `workout-count` to claim a weekly workout
total when the source reports a different aggregation. Do not claim a prior-week
change without compatible prior-period evidence.

A returned absence proves only that no usable fact was returned. Do not blame
sync, permissions, provider import, device behavior, or the member.

## Recipient privacy

The email edition may name or compare only members returned by `prepare` as
currently eligible recipients and only with the facts returned for them. Never
mention who lacks email, who declined a scope, who had insufficient data, or who
failed eligibility. Do not expose raw addresses, handles, member ids, grant ids,
provider ids, or internal errors.

If there are no eligible email recipients, do not send an empty edition. Use only
the configured first-party setup handoff permitted by the current public
contract. If recipients exist but no member has usable completed-day stats, a
short non-comparative edition is allowed; do not invent a cause.

## Delivery and retry

After any email `send` result—including sent, partial failure, no recipients,
unavailable, or failed—do not retry `send` in the same turn. Return exactly a
notification decision shaped like
`{"kind":"skip","privateSummary":"..."}` with a short factual private
summary. The email tool and runtime own delivery, retry, and backoff. Never also
return `send_message`, a duplicate digest, a public operational error, or a
second delivery confirmation.

Current-chat delivery uses the ordinary idempotent conversation outbox once. A
scheduled run may not redirect to a model-supplied room, member, address, or
thread.

## Editorial boundary

Facts, coverage, privacy, and delivery truthfulness outrank tone. Never fabricate
a statistic, quote, rivalry, diagnosis, private reason, or participant. The
complete hosted story selection, room-native presentation, humor calibration,
and edition craft live in Murph Cloud rather than this public baseline.
