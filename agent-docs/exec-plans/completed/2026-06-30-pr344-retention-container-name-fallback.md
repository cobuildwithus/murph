# PR 344 Retention Container Name Fallback

## Goal

Fix ReviewGPT round 15: foreground/default work must not be permanently blocked by a legacy `inbox_media_retention` fence whose `runnerContainerName` is null.

## Constraints

- Reuse the existing active-runtime container-name fallback.
- Do not add new state, routes, schedulers, or lifecycle owners.
- Preserve durable authority checks on attempt id, lease generation, and user id.

## Approach

- Export the existing active-runtime container-name resolver from the wake helper.
- Use it for retention liveness and abort paths before reading `activeFence.runnerContainerName` directly.
- Add a regression for null `runnerContainerName` retention fences.

## Verification

- Focused UserRunner tests.
- Focused RunnerContainer/runtime transport tests.
- Cloudflare typecheck.
Status: completed
Updated: 2026-06-30
Completed: 2026-06-30
