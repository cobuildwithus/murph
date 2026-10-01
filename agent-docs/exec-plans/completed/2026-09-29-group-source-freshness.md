# Report stalled wearable sources honestly in groups

Status: completed
Created: 2026-09-29
Updated: 2026-09-29

## Outcome and invariant

Group updates distinguish a connected source from stalled delivery and do not infer that a missing record will arrive after a later report time. Existing consent, source attribution, and bounded single-read recovery remain unchanged.

## Owner and evidence

Web owns consented device status. Its existing query omits arrival evidence, so fresh polling hides a stale source. Reuse the device-sync source-staleness policy to derive the existing needs-attention status. The assistant recovery instruction currently mandates a delay offer from recent shared history alone, which does not establish arrival timing.

## Scope and decisions

- Derive coarse attention status for detected source stalls without changing stored connection status or the shared wire format.
- Require timing evidence before proposing a later scheduled report; include every reported metric/date in the bounded freshness request.
- Preserve explicit schedule requests and the existing versioned patch authority.
- No new persistence, polling, provider recovery, automatic reconnect, deployment or member messages.
- Old and new readers accept the existing status enum; Web and runtime can deploy independently. Mixed versions may retain old wording until runtime rollout, but cannot reject the payload.

## Product UX

- Outcome: show available records and truthful gaps without implying a successful upload or an unsupported timing fix.
- Reaches: scheduled group reports and consented group device troubleshooting; private setup and manual schedule changes stay unchanged.
- Proof: fresh, stalled, never-delivered, disconnected and recovered source reads; synthetic scheduled reports with and without known late-arrival history and multiple dates.

## Tasks

1. Add focused source-status and assembled-prompt regression tests.
2. Update existing status derivation and recovery instructions, and their contract documentation.
3. Run focused tests, relevant typechecks, synthetic real-model journeys and parent review.
4. Rerun bounded hosted diagnostics; distinguish live observations from local fixes.
5. Close plan and create scoped commit.

## Verification

- Web shared-read and freshness suites: 58 passed, including eight source-status cases and recovery readback.
- Assembled group prompt suite: 9 passed.
- Changelog production rendering: 10 passed.
- Web and assistant-engine typechecks passed.
- Three focused real-Codex journeys passed using the local subscription and the runner-default model: missing record, known late arrivals, and multiple dates. Each made exactly one shared read and zero automation mutations.
- Parent reply review: Ready. Gaps stay unknown, ordinary missing records do not trigger timing offers, known timing evidence permits a consent-based offer, and all requested dates are checked.
- Complexity guard passed; the pre-existing join-acceptance hotspot is unchanged. No network calls, extra SQL queries, persisted state, protocol fields, or new dependencies were added.
- Privacy and diff checks passed. Live diagnostic results remain outside repository artifacts.
- Local fixes are not deployed. Broad CI and external final review belong to a future authorized PR delivery; this task prepares a local scoped commit.

## Diagnostic boundary

Bounded production checks were rerun through existing read-only helpers and hosted diagnostic endpoints. Live health evidence and identifiers are intentionally omitted. A successful provider read or snapshot publication does not prove that missing device records exist.
Completed: 2026-09-29
