# Timezone-safe assistant timestamps and wearable import timing

Status: active
Created: 2026-08-10
Updated: 2026-08-10

## Goal

- Prevent the assistant from confusing UTC clock values with the member's local timezone, and make wearable import latency diagnosable from provider event occurrence through successful Murph import.

## Success criteria

- Inbound event timestamps shown to the assistant include a deterministically formatted local clock in the vault's canonical IANA timezone plus the original UTC instant.
- A focused regression proves that an August UTC instant renders with the correct America/New_York daylight-saving offset.
- Signed provider-send timestamps, webhook receipt timestamps, and provider event timestamps survive the existing webhook-to-runtime handoff when available.
- Successful hosted imports emit metadata-only structured timing logs that distinguish upstream delivery delay, Murph webhook-to-import delay, total event-to-import delay, runtime queue time, and import execution time.
- Invalid, unavailable, clock-skewed, or coalesced timing data is represented honestly without blocking webhook acceptance or import execution.
- Focused tests, affected package typechecks, exact-head CI, and required ReviewGPT gates pass.

## Scope

- In scope:
  - Assistant auto-reply prompt timestamp rendering.
  - Verified signed-send timestamp extraction for Junction, Oura, WHOOP, and Strava webhooks.
  - Metadata-only timing propagation through the existing dirty-resource carrier.
  - Successful import timing events in the existing hosted runtime-log sink.
  - Focused tests and durable device-sync/runtime-log documentation.
- Out of scope:
  - New queues, databases, dashboards, alerting systems, or provider polling behavior.
  - Claiming visibility into provider-internal stages that providers do not expose.
  - Historical backfill for imports completed before this change.

## Constraints

- Technical constraints:
  - Observability must be best-effort, nonblocking, metadata-only, and content-free.
  - Provider timestamps are accepted only from verified webhook envelopes or typed provider fields.
  - Existing device-sync push and pull paths, foreground priority, and hosted-runtime ownership remain unchanged.
- Product/process constraints:
  - Preserve confidential incident evidence outside repository artifacts.
  - Prefer one explicit source of truth and the smallest owner-bound change.
  - Use a task worktree, focused proof, scoped commit, PR, CI, and required ReviewGPT gates.

## Risks and mitigations

1. Risk: Provider clocks can be skewed or an event can precede webhook emission by an unusually long interval.
   Mitigation: Preserve the source timestamps, emit a duration only for valid nonnegative intervals, and keep each stage separately queryable.
2. Risk: Multiple compact webhook hints can coalesce before import.
   Mitigation: Carry the first timestamp in the coalesced batch and the event count; document that the resulting duration is oldest-event latency.
3. Risk: Telemetry could leak wearable content or add hot-path latency.
   Mitigation: Log only categorical metadata, timestamps, counts, and derived durations through the existing buffered info-log writer after successful import.
4. Risk: Prompt wording alone could still invite timezone arithmetic errors.
   Mitigation: Render the member-local clock deterministically in code and pair it with the UTC instant.

## Tasks

1. Prove the timezone failure at the assistant prompt boundary and map the current webhook-to-import timing owners.
2. Add deterministic timezone-aware prompt rendering and a daylight-saving regression test.
3. Extract verified provider-send timestamps and preserve event, receipt, and send timing through existing webhook and dirty-resource types.
4. Emit successful import timing logs with safe duration derivation and focused runtime tests.
5. Update durable contracts, run focused verification and typechecks, then commit, push, open the PR, and run ReviewGPT with CI.

## Decisions

- The prompt will include both the canonical IANA-zone local clock and UTC instant; the model will not be asked to perform the conversion.
- The existing dirty-resource handoff and hosted runtime-log sink will carry observability; no new persisted state owner or queue will be added.
- Verified webhook signature timestamps will represent provider-send time. They do not claim to represent wearable-to-provider-cloud sync time.
- For coalesced resources, first timestamps and event count will describe oldest-event latency.

## Verification

- Commands to run:
  - Focused Vitest suites for assistant automation prompts, provider ingress, web dirty-state persistence, hosted device-sync runtime, and maintenance logging.
  - Typechecks for each changed package/application.
  - Repository-required completion checks, PR CI, preliminary specialist ReviewGPT, and final ReviewGPT round 1 on the exact pushed head.
- Expected outcomes:
  - The timezone regression renders a synthetic summer UTC instant as the correct America/New_York local clock.
  - Valid signed-send, event, receipt, and import-completion timestamps produce stage-specific nonnegative delays.
  - Missing or negatively ordered timestamps omit only the affected derived duration.
  - No raw webhook payload or direct identifier appears in runtime timing logs.
