# Device Sync Protocol Hard Cut

## Goal

Remove the temporary web-to-Cloudflare dirty-state compatibility paths now that deployed hosted execution supports the dirty pending/ack protocol.

## Context

The hosted device-sync webhook path has moved from high-cardinality mailbox/workflow fanout to trace/audit plus web-owned dirty state plus best-effort runner nudges. During the staggered deploy window, the runtime kept optional dirty-state port methods and legacy explicit dirty-wake parsing so old and new producers/consumers could overlap. After deployment, the runtime should pull pending dirty state directly and treat dirty ack as a required checkpoint-safe protocol surface.

## Scope

- Make dirty pending fetch and dirty ack required on `HostedRuntimeDeviceSyncPort`.
- Remove the explicit dirty mailbox wake path and `fetchDirtyState` runtime port if it is no longer needed.
- Remove `dirtyConnectionId` / `dirtyRevision` wake-hint parsing where it only served the transitional mailbox adapter.
- Keep lifecycle wakes for connection-established and disconnect.
- Preserve legacy trace/job-hint parsing only where needed for possible old mailbox wake drain.

## Non-Goals

- Do not remove lifecycle mailbox wakes.
- Do not change the dirty-state schema.
- Do not broaden deploy automation changes already active in the dirty checkout.

## Verification

- Focused assistant-runtime/device-sync tests.
- Focused Cloudflare runtime-platform tests if Cloudflare port surface changes.
- Relevant hosted web wake tests if web wake types change.
- Typecheck for touched owners.
Status: completed
Updated: 2026-05-05
Completed: 2026-05-05
