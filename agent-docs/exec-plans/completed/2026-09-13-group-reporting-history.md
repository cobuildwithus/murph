# Group reporting history and missing-data recovery

Status: completed
Created: 2026-09-13

## Outcome and evidence

The current recovery predicate waits for any granted missing day. The scheduled
instruction offers a later report for any such sleep gap. Neither distinguishes
recent contributors from long-established grants with no recent records.

## Design and ownership

Derive per-scope, per-date gap evidence from the current consent-filtered snapshot.
A record in the seven preceding calendar days demonstrates recent reporting.
An established grant older than that window with no such record demonstrates only
no recent reporting, never a disconnected device. New, pending or legacy grants
without sufficient age evidence retain conservative recovery. Existing sync work
still gets one bounded request for active missing sources; long-absent reporters
do not extend polling or alone trigger a schedule offer. Stop waiting when recent
or unknown gaps resolve, even if established nonreporters remain absent.

Keep the classifier in the existing hosted-execution freshness helper. Reuse it
in runtime polling and the assistant model adapter; attach dated evidence to each
projection at the model boundary. No new database, history store, network call,
Web transport field, provider exposure or scheduler. Grant loss removes evidence
on every reread. Existing producer skew and cancellation behavior remain valid.

## Product UX and proof

Outcome: publish available results promptly and target genuine reporting gaps.
Entry: scheduled report or dated attended read. Unknown-history members retain
recovery; no recent reporting alone does not justify delaying the group schedule.
Proof: recent/old/new/legacy/pending/revoked grants, exact dates and scope isolation;
mixed groups with expected reporters complete or missing; early stop after their
arrival; model-visible evidence and real composed scheduled replies. All available
values remain intact, absence never means zero or disconnection, schedule writes
still require consent. Focused tests, affected typechecks, complexity, input-byte
measurement, parent review, PR update, final ReviewGPT and exact-head CI.

## Progress

- Existing PR ownership verified at its clean pushed head.
- No production state changes or member messages are authorized by this work.

## Local completion

Parent review confirms a single derived classifier, unchanged sync authority and
fanout, no new wire fields or state owner, and unchanged ordinary reads.
Protocol/runtime/model boundary tests pass (143); focused control-copy tests,
Web sync tests and changelog rendering pass. Four affected package/app typechecks
and the complexity guard pass. Live mixed-complete, mixed-missing, unknown-history
and prior-decline journeys are Ready; each performs one shared read and no
automation writes. The model distinguishes ongoing absence from late data and
includes a check time for unknown history without suggesting a later schedule.

Complete first-provider input remains unchanged for individual chats; group input
is 152,347 bytes versus 147,259 at the PR base (+5,088, 3.46%). This follow-up
adds 1,080 bytes to the prior candidate. Exact target tokenization is unavailable.

PR #3377 owns the next full review and exact-head CI after this local completion
record; those external gates are not claimed as passed here. No production state
changes, deployments or member messages occurred.
Updated: 2026-09-12
Completed: 2026-09-12
