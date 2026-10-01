# Group wearable freshness checks and schedule recovery

Status: completed
Created: 2026-09-12
Updated: 2026-09-12

## Goal

Before reporting dated shared wearable metrics, check the required dates, request
existing member sync work for missing consented data, allow a bounded grace period,
and explain remaining gaps with a truthful check time. Offer a later recurring
schedule; change it only after an authorized affirmative reply.

## Evidence and owners

The current group reader returns Web-owned projection snapshots without triggering
device ingestion. The existing manual reconcile wake imports into the member vault
and existing post-checkpoint publication replaces the shared snapshot. Group reads
remain consent-filtered. A fresh snapshot can still lack the requested calendar day.

## Design

- Extend the existing shared-read request with bounded exact scope/date freshness
  requirements. Do not add a second health store or provider-to-group shortcut.
- Web resolves current eligible grantors and queues existing manual reconcile wakes
  only for missing requested dates. Deduplicate requests across group reads.
- Runtime owns a bounded, cancelable recheck inside one tool request: a short
  foreground wait and up to five minutes for a scheduled group occurrence.
- Return check time and explicit refresh outcome. Reading shared data does not prove
  a provider was contacted or that a watch uploaded; pending and failed refreshes
  must remain distinct from a successfully refreshed empty result.
- Reuse canonical automation inspect/patch for an accepted thirty-minute delay;
  preserve recurrence, timezone, content and other settings. No automatic schedule
  mutation or repeated offer after a decline visible in conversation context.

## Constraints and failure behavior

No production mutations or member messages during development. Synthetic proof
only. Current group/grant/access authority is rechecked for every returned snapshot.
Do not expose private connection metadata without its separate grant. Bound dates,
scopes, members, concurrent wakes, total wait, and cancellation. Preserve existing
read-only callers and handle absent freshness capability conservatively during
independent deploys. Missing data is never zero or proof of missing consent.

## Product UX

Effort: feature.
Entry: scheduled wearable update or explicit current-data request.
Journeys: already available; arrives during grace; still missing; sync unavailable;
permission absent/revoked; foreground cancellation; legacy runtime; accepted schedule
change; declined schedule change; unrelated update with no wearable refresh.
Done when results are accurate, dated, concise, and shared only with current consent,
and only an authorized affirmative reply changes the recurring schedule.

## Tasks

1. Finish transport, sync, cancellation and scheduling owner trace.
2. Add focused deterministic regressions and the bounded freshness implementation.
3. Add production-composed reply and schedule-change real-Codex journeys.
4. Run focused tests/typechecks, inspect actual replies and review the full diff.
5. Update durable owner docs and changelog; complete scoped commit and PR gates.

## Verification

Protocol/schema validation, consent and fanout tests, runtime fake-clock grace and
cancellation tests, model tool call ordering and truthful reply tests, canonical
schedule inspect/patch preservation, relevant package/app typechecks, complexity
guard, focused local-subscription journeys and required exact-head CI/review.

## Progress

- Isolated checkout created. No production state changed.
- Added bounded scope/date validation, current eligibility checks and existing
  manual-reconcile wake reuse. Results remain ordinary consent-filtered snapshots.
- Runtime requests sync once, then rereads for up to fifteen seconds in foreground
  or five minutes for scheduled groups, with cancellation and old-producer fallback.
- Deterministic protocol, tool, Web and runtime proof passed, including 227 Web
  tests. Relevant package and Web typechecks passed before final prompt edits.
- Complexity guard passed after simplifying the parser and separating the bounded
  polling loop from transport recovery.
- A focused live missing-data journey exposed a conflict with generic scheduled
  control-copy suppression. Added an explicit group recovery exception and a
  composed-prompt regression; the corrected live reply passed subsequent revalidation.
- Initial subscription attempts failed before provider actions. The documented
  alternate-home path reached the provider; continue on that same authenticated
  home. No auth material was read or copied.

- Live proof now covers present data, missing data, unavailable refresh, accepted
  schedule change, declined change and a prior decline suppressing a new offer.
  The accepted patch preserves the daily recurrence and stored timezone and uses
  the inspected version; the confirmation names a differing timezone.
- Final boundary review found and fixed freshness-field stripping in foreground
  chat context. Email context strips freshness and read-only runtime readers
  reject it before Web I/O; scheduled and attended group readers opt in explicitly.
- Reused existing Frog entry 20260911184822-documented-changelog-test for the
  documented test command mismatch. Generation followed by the root Web workspace
  test command passes; no duplicate friction entry was created.
- Complete first-provider-input capture uses the real App Server and synthetic
  Responses stub. Individual input is unchanged; the group delta includes both
  the shared schema and recovery instructions. Exact Terra token counts are
  unavailable because no exact target tokenizer is configured.

## Local completion

Implementation and parent candidate review are complete. All six focused live
journeys are Ready. Final focused Web coverage passed 239 tests, runtime coverage
passed 61 tests, and protocol/prompt/parser checks passed. All four affected
package/app typechecks, complexity, documentation checks and privacy review pass.
The complete group provider input increases by 4,008 bytes (2.72%); individual
input is unchanged. Exact target token counts remain unavailable.

PR #3377 owns required exact-head CI and final ReviewGPT after this local
completion record. Those external gates are pending, not claimed as passed.
No production refresh, schedule mutation, member message or deployment occurred.
Completed: 2026-09-12
