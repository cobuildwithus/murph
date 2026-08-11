# Timezone-safe assistant timestamps and wearable import timing

Status: completed
Created: 2026-08-10
Updated: 2026-08-11

## Goal

- Prevent the assistant from confusing UTC clock values with the member's local timezone, and make wearable import latency diagnosable from provider event occurrence through successful Murph import.

## Success criteria

- Inbound event timestamps shown to the assistant include a deterministically formatted local clock in the vault's canonical IANA timezone plus the original UTC instant.
- A focused regression proves that an August UTC instant renders with the correct America/New_York daylight-saving offset.
- Exact signed provider-send-to-receipt duration and the earliest webhook receipt survive the existing webhook-to-runtime handoff when available; exact provider event time is reduced to a coarse upstream-delay bucket before it enters the new timing carrier.
- Eligible same-pass hosted imports emit privacy-limited structured timing logs that distinguish coarse event-to-provider delay, exact provider-send-to-receipt and Murph webhook-to-import delay, runtime queue time, and import execution time; the best-effort event is not an exhaustive import ledger.
- Invalid, unavailable, clock-skewed, or coalesced timing data is represented honestly without blocking webhook acceptance or import execution.
- Focused tests, affected package typechecks, exact-head CI, and required ReviewGPT gates pass.

## Scope

- In scope:
  - Assistant auto-reply prompt timestamp rendering.
  - Verified signed-send timestamp extraction for Junction, Oura, WHOOP, and Strava webhooks.
  - Privacy-limited timing propagation through the existing dirty-resource carrier.
  - Successful import timing events in the existing hosted runtime-log sink.
  - Focused tests and durable device-sync/runtime-log documentation.
- Out of scope:
  - New queues, databases, dashboards, alerting systems, or provider polling behavior.
  - Claiming visibility into provider-internal stages that providers do not expose.
  - Historical backfill for imports completed before this change.

## Constraints

- Technical constraints:
  - Observability must be best-effort, nonblocking, and omit health-event semantics and exactly reversible event-origin timestamps.
  - Provider timestamps are accepted only from verified webhook envelopes or typed provider fields.
  - Existing device-sync push and pull paths, foreground priority, and hosted-runtime ownership remain unchanged.
- Product/process constraints:
  - Preserve confidential incident evidence outside repository artifacts.
  - Prefer one explicit source of truth and the smallest owner-bound change.
  - Use a task worktree, focused proof, scoped commit, PR, CI, and required ReviewGPT gates.

## Risks and mitigations

1. Risk: Provider clocks can be skewed or an event can precede webhook emission by an unusually long interval.
   Mitigation: Bucket valid nonnegative event-to-send delays before persistence, and omit invalid measurements.
2. Risk: Multiple compact webhook hints can coalesce before import.
   Mitigation: Retain the slowest coarse upstream bucket, longest signed-send-to-receipt duration, and earliest Murph receipt in the coalesced batch.
3. Risk: Telemetry could leak wearable content or add hot-path latency.
   Mitigation: Log only a coarse upstream bucket, generic routing metadata, and operational durations through the existing buffered info-log writer after successful import.
4. Risk: Prompt wording alone could still invite timezone arithmetic errors.
   Mitigation: Render the member-local clock deterministically in code and pair it with the UTC instant.

## Tasks

1. Prove the timezone failure at the assistant prompt boundary and map the current webhook-to-import timing owners.
2. Add deterministic timezone-aware prompt rendering and a daylight-saving regression test.
3. Extract verified provider-send timestamps, bucket event-to-send delay at ingress, and preserve the signed-send-to-receipt duration plus earliest receipt through existing webhook and dirty-resource types.
4. Emit successful import timing logs with safe duration derivation and focused runtime tests.
5. Update durable contracts, run focused verification and typechecks, then commit, push, open the PR, and run ReviewGPT with CI.

## Decisions

- The prompt will include both the canonical IANA-zone local clock and UTC instant; the model will not be asked to perform the conversion.
- The existing dirty-resource handoff and hosted runtime-log sink will carry observability; no new persisted state owner or queue will be added. Exact event occurrence and health-event semantics will not be added to runtime logs.
- Verified webhook signature timestamps will represent provider-send time. They do not claim to represent wearable-to-provider-cloud sync time.
- For coalesced resources, the slowest coarse upstream bucket, longest signed-send-to-receipt duration, and earliest receipt describe the batch without pairing timestamps from different events or logging health-event facts.

## Verification

- Commands to run:
  - Focused Vitest suites for assistant automation prompts, provider ingress, web dirty-state persistence, hosted device-sync runtime, and maintenance logging.
  - Typechecks for each changed package/application.
  - Repository-required completion checks, PR CI, preliminary specialist ReviewGPT, and final ReviewGPT round 1 on the exact pushed head.
- Expected outcomes:
  - The timezone regression renders a synthetic summer UTC instant as the correct America/New_York local clock.
  - Valid signed-send, event, receipt, and import-completion timestamps produce a coarse upstream bucket plus stage-specific nonnegative operational delays.
  - Missing or negatively ordered timestamps omit only the affected derived duration.
  - No raw timestamp, health-event semantic, webhook payload, or direct identifier appears in runtime timing logs.

## Results to date

- Production evidence separated the incident into an upstream arrival delay and
  a later assistant interpretation error: the relevant provider webhook had not
  reached Murph at the first question, and the later answer relabeled UTC clock
  values as Eastern time.
- The foreground reply owner now resolves one canonical time context and threads
  the same object through occurrence rendering, developer/system planning, and
  late-input admission. Missing or invalid vault timezone metadata stays exact
  UTC-only and never inherits a runtime-local label.
- Ingress reduces event-origin time before it enters the new timing carrier,
  measures signed-send-to-receipt exactly, and retains the earliest Murph
  receipt. Pre-existing dirty-window and clean-transition wake fields continue
  to use occurrence time. Coalesced hints merge the privacy-reduced measurements
  without adding wakes; compact jobs, encrypted-payload jobs, and locally
  deduplicated jobs emit at most one completion record per unique local job
  while all payload ids are acknowledged. A compact retry that crosses runtime
  passes can complete without this best-effort event because the timing
  association is pass-local.
- The real Codex App Server scenario passed against the target model: the first
  turn did not invent an absent run, and a resumed turn after the controlled
  import appeared reported the synthetic 2.4-mile activity and the original
  question as 1:45 PM local / 17:45 UTC in the same session.
- Post-merge focused verification passes: Assistant Engine 341 tests, Assistant
  Runtime 166 tests, Web device-sync/changelog 145 tests, and device-syncd 442
  tests, plus typechecks for all four affected packages/app. The separate
  synthetic real-model E2E passes with one executed case and 61 gated cases
  skipped. Exact-head release CI passes; the sole failed rerun used the original
  pull-request body event and will be replaced by the final-head event.
- Final ReviewGPT round 1 findings were accepted and remediated by removing raw
  health-event facts and exact event-origin intervals from member-linked logs,
  making timezone failure UTC-only, correcting Strava event occurrence, and
  documenting compact versus encrypted dirty-state storage honestly.
- The preliminary specialist findings were remediated with terminal real-model
  proof, one turn-owned time authority, missing/malformed/valid Strava coverage,
  and complete coalesced/compact/deduplicated job timing coverage.
- Final ReviewGPT round 2 returned `ROUND_OUTCOME: PASS` with no qualifying
  findings. Its four documentation discrepancies were accepted: the timezone
  read moved from planning to the foreground owner; already-dirty level hints
  now use the existing upsert path; privacy reduction applies to the new timing
  carrier rather than pre-existing dirty-window fields; and cross-pass compact
  retries can omit the best-effort completion event.
Completed: 2026-08-11
