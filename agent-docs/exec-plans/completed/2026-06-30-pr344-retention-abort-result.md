# PR 344 Retention Abort Result

## Goal

Fix the ReviewGPT round 13 foreground-preemption gap where default work can wait behind `inbox_media_retention` if RunnerContainer lost its local active-operation pointer while the child is still active.

## Constraints

- Use the existing identity-checked workspace invocation abort endpoint.
- Do not add a new scheduler, queue, persisted state, route, or broad lifecycle owner.
- Preserve fail-closed behavior for stale/mismatched runtime identity.
- Preserve direct Durable Object RPC calls.

## Approach

- Make `abortWorkspaceInvocation` return a small explicit status.
- Allow it to post to the existing abort endpoint when the local pointer is missing but the container may still be active.
- Let UserRunner retention preemption clear/replace only after abort reports an accepted, queued, or inactive-safe outcome.

## Verification

- RunnerContainer abort regression for missing local pointer plus active child.
- UserRunner foreground-preemption regression for indeterminate liveness plus accepted abort.
- Focused Cloudflare runtime tests and typecheck.
Status: completed
Updated: 2026-06-30
Completed: 2026-06-30
