# Checkpoint-aware stall alerts

Status: completed
Created: 2026-09-18
Updated: 2026-09-18

## Goal

Prevent operational stall alerts from treating completed work awaiting its normal checkpoint as a stopped runtime, without hiding missing work or overdue durable acknowledgement.

## Scope and ownership

- Keep the existing Web device-import and mailbox-progress monitors, runtime timing evidence, and incident email owner.
- Conversation heads may defer only with exact-item accepted delivery or committed terminal reply/no-reply evidence and a valid existing checkpoint-publication deadline.
- Device passes have no publication deadline in their diagnostic contract. Give proven unsaved continuation progress one bounded 15-minute publication allowance, anchored to the first outstanding progress rather than refreshed by every pass. Continue requiring the matching accepted checkpoint to credit saved progress.
- Preserve overdue wake detection, connection isolation, failed/no-progress work, cycling and runnable-backlog diagnostics, and reply/typing/failure alerts.
- Extend the existing signed latency callback with bounded delivered-mailbox evidence and email source support. Reuse its phase JSON, lease fence, and retry budget; no migration, scheduler, provider call, or awaited foreground work. Missing or malformed evidence retains conservative alerting.

## Evidence and protected invariants

The device monitor can classify an old saved-progress timestamp as stalled immediately after a productive pass. The mailbox monitor uses accepted-work age without reading existing per-item completion and checkpoint-publication evidence. Runtime idle batching is ten minutes; successful work need not be acknowledged immediately.

## Tasks

1. Reproduce productive unsaved device passes and delivered conversation heads; retain negative controls for absent, stale, unrelated, and expired evidence.
2. Apply bounded grace in the existing monitors and update their reliability contract.
3. Exercise email staging, successful/failed delivery callbacks, channel deadline updates, monitor composition, real PostgreSQL projection, focused regressions, and relevant typechecks; review the diff and complexity.
4. Close the plan and make a scoped commit. Report deployment separately.

## Verification

- Focused device health and alert integration suites.
- Conversation progress, existing reply-latency, typing and failure-alert regression suites.
- Local PostgreSQL progress-monitor and latency concurrency proofs with synthetic rows and scoped cleanup.
- Hosted Web, Worker, assistant-runtime and hosted-execution typechecks; hosted-execution package build; complexity diff and documentation checks.

## Risks

Unrelated deliveries, timestamps before admission, invalid or expired deadlines, and repeated unsaved passes must never create indefinite grace. Completion evidence is diagnostic only; canonical mailbox and continuation acknowledgement remain checkpoint-owned.

## Changelog

Internal operational alert correction; no member-visible product behavior changes.

## Completed evidence

- Device import, conversation progress, latency store, signed callback route, reply-latency and adjacent failure-alert tests pass. New cases prove finite grace, no saved-progress credit before checkpoint, per-connection isolation, and unchanged alerting for missing or expired evidence.
- Email import, successful/failed delivery callbacks, detached bounded retries, all-channel idle deadlines, and terminal no-reply runtime tests pass. The completion callback uses the original sent timestamp and chunks exact answered IDs at 64.
- All 15 local PostgreSQL progress and latency concurrency cases pass, including exact-item email completion, deadline expiry, stale-lease rejection, original backlog age, unchanged canonical consumption, and candidate scan bounds.
- Shared contract tests: 42 pass. Worker forwarding tests: 326 pass, including the new email completion event through the existing signed callback path.
- Web, Worker, assistant-runtime and hosted-execution typechecks pass. Hosted-execution package build passes. Complexity guard, documentation drift/gardening and whitespace checks pass.
- Parent review checked the complete diff, private-data boundary, bounded callback writes, conservative missing-evidence behavior, and checkpoint ownership. Existing large runtime functions keep their prior complexity; the new checks remain in the telemetry and alert helpers.

## Delivery and release boundary

This task delivers a scoped local commit. No production changes, PR submission,
ReviewGPT run, or CI run were performed. A later PR retains the repository's
cross-owner final-review and exact-head CI gates.

Deploy the Web callback consumer, then the Worker callback parser, then the
runner producer. Old producers remain accepted by the new consumer. New
telemetry rejected by an older consumer remains detached and best-effort;
alerts conservatively keep their earlier behavior. No schema migration or
canonical runtime-state change is required. Rollback may remove diagnostic
coverage but does not change delivery or checkpoint ownership. After deployment,
verify productive device passes and delivered conversation heads remain quiet
within their allowance and overdue checkpoints still alert.

## Product and architecture review

Internal operational alert behavior only; member prompts, provider requests,
message contents, scheduling, and delivery semantics are unchanged. No real-model
journey or rendered UI proof applies. Existing latency trace JSON, write fencing,
retry budget, deadline resolver, monitors, and incident email owner are reused.
Completion telemetry adds no awaited database or network work to a reply: each
bounded delivery callback performs at most one scoped lookup and one set-based
write, with the existing three-attempt retry budget. No new state owner,
scheduler, dependency, or database table was added.
Completed: 2026-09-18
