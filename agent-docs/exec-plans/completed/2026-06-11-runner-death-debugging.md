# Runner-death debugging instrumentation

Status: completed

## Why

Two prod incidents on 2026-06-11 (04:47 and 16:54 UTC, plus a third container
death at 00:36 UTC on another DO) share one mechanism, proven from
`hosted_runtime_log`, `hosted_mailbox_lane_counter`, and Cloudflare Workers
telemetry:

1. A warm runner container died **unrequested with exit code 1** ~2.5–3 min
   after its last foreground pass (at/just before end-of-invocation wind-down),
   before any durable checkpoint. The in-container fatal cause is unknowable
   post-hoc: container stdout is console-only and never reaches a queryable
   sink.
2. The replacement attempt restored the last snapshot (up to ~10 min stale) and
   re-imported the already-answered conversation prefix as fresh reply
   candidates, producing duplicate, context-rolled-back replies on linq+email.
3. The durable consumed watermark (PR #110) — built to make exactly this replay
   reply-safe — has **never engaged in prod**: `consumed_seq = 0` for every
   member/lane ever, and worker telemetry shows zero POSTs to
   `/api/internal/hosted-mailbox/consume` since deploy. The ack
   (`acknowledgeHostedConversationMailboxConsumedBestEffort`) has four silent
   early-returns; static analysis shows the reply-failed, port, and watermark
   gates pass on real reply passes, so the skip reason is unconfirmed and
   unlogged.

## Scope (instrumentation only — no behavior fixes yet)

1. **Consume-ack skip/advance logging** (`packages/assistant-runtime`):
   every early-return in the consume ack writes a runtime-log event with a
   distinct skip reason; successful advances log the acked seq. New event codes
   `mailbox.consume_ack_skipped` / `mailbox.consume_ack_advanced` in
   `packages/hosted-execution/src/runtime-control.ts`. One prod reply pass then
   pins the dead gate.
2. **Durable container fatal traces** (`apps/cloudflare`): the container
   entrypoint reports process-fatal events (uncaughtException,
   unhandledRejection, shell-isolation poison, ambiguous-abort poison, startup
   failure) to the worker via a new bounded internal endpoint
   (`runner-control.worker/v1/container-fatal`) before exiting 1. The egress
   intercept handles the path at the stateless worker layer (no DO dependency)
   and emits a structured worker log, making the next container death
   attributable from telemetry. Payload reuses the entrypoint's existing
   safe-error metadata shape; worker side sanitizes/caps all fields.

Deferred (not in this plan): readiness-timeout tuning lives in
`apps/cloudflare/src/runner-container.ts` (`ensureContainerReady`), which is an
active ledger lane ("Hosted runner destroy timeout triage"); checkpoint-cadence
changes were considered and rejected by the operator.

## Verification

- `pnpm test:diff` over touched owners (assistant-runtime, hosted-execution,
  apps/cloudflare).
- Unit tests: ack skip/advance logging per gate; fatal-report payload build +
  swallow-on-failure; egress intercept fatal route (method/host/path/size
  guards, log emission, 204).
- Post-deploy: one real reply pass should emit either
  `mailbox.consume_ack_advanced` (watermark fixed by observation) or a
  `mailbox.consume_ack_skipped` row naming the dead gate; next unrequested
  container stop should be preceded by a `container-fatal` worker log.

## Deployment concerns

New runtime-log event codes are posted by the runner and validated by the web
route parser from the same `@murphai/hosted-execution` source: deploy web
(Vercel) before Cloudflare, mirroring PR #110's order.
Updated: 2026-06-11
Completed: 2026-06-11
