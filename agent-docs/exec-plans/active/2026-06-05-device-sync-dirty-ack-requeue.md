# Device Sync Dirty Ack Requeue

## Goal

Make remaining hosted device-sync dirty work requeue device-sync directly at the
dirty-ack boundary instead of depending on assistant workspace wake metadata.

## Constraints

- Keep Cloudflare and the hosted/local runtime as thin runners.
- Do not change generic wake priority or add scheduler state.
- Preserve foreground assistant preemption over background device-sync work.
- Keep provider payloads, secrets, and direct identifiers out of logs/tests.

## Plan

1. Add the existing hosted device-sync maintenance signal at the web dirty-ack
   boundary when pending dirty work remains.
2. Keep the existing `nextWakeAt` response as a compatibility fallback.
3. Add focused regressions proving dirty-ack requeue and foreground preemption
   expectations.
4. Run focused verification, completion audits, then archive this plan in the
   final scoped commit.

## Verification

- Pending.
