# Round 2 Latency Alert Disabled-State Clear

## Status

Active.

## Why

The hosted runtime latency monitor returns immediately when its dedicated alert
chat is unconfigured. If an earlier incident is still `latency_alerting`, a
healthy scan during that disabled interval never clears the incident. A later
anomaly after reconfiguration is then suppressed as the same active incident.

## Outcome

A healthy disabled scan clears only an existing active latency incident without
creating monitor state or sending a message. Re-enabling the monitor after a
later anomaly opens a fresh incident with a fresh idempotency identity.

## Invariants

- Disabled monitoring never creates state or sends an alert.
- Only the fixed latency-monitor row and valid latency-monitor status are read.
- Healthy disabled scans clear only an exact-CAS `latency_alerting` row.
- Anomalous disabled scans preserve the active incident for later coalescing.
- In-flight, failed, invalid, and concurrently changed states are not erased.
- Alert payloads remain aggregate and identifier-free.
- No new state owner, status, retry path, transport, or dependency is added.

## Scope

- `apps/web/src/lib/hosted-runtime-latency/alert-monitor.ts`
- `apps/web/test/hosted-runtime-latency-alert-monitor.test.ts`
- This plan and its coordination-ledger row

## Work

1. Add a failing regression for alert, disable, healthy clear, new anomaly,
   re-enable, and fresh alert delivery.
2. Without upserting when disabled, exact-CAS clear only the fixed active
   latency incident on a healthy scan.
3. Run focused Web tests, canonical diff and acceptance verification,
   preliminary coverage-specialist ReviewGPT, product-experience review, parent
   final review, final ReviewGPT, and PR CI.
4. Close with `scripts/finish-task`; keep the PR draft and unmerged.

## Verification

- Focused alert-monitor regression, failing before and passing after
- `pnpm test:diff apps/web/src/lib/hosted-runtime-latency/alert-monitor.ts apps/web/test/hosted-runtime-latency-alert-monitor.test.ts`
- `pnpm verify:acceptance`
- Preliminary `completion-specialists` coverage lens
- Product-experience review and parent final call-path review
- Final ReviewGPT exact-head gate and required PR CI
