# Assistant Response Media

## Goal

Land response-media support from the supplied patch:

- static hosted media catalog under the web public directory
- assistant media discovery and attach CLI commands
- response media staged for the active assistant turn
- outbox-native media persistence and dedupe
- Linq multipart text/media delivery
- explicit fail-closed behavior for unsupported outbound channels

## Constraints

- Keep the change aligned with existing assistant runtime, outbox, and channel boundaries.
- Do not introduce direct send-side effects from media attach.
- Store only public HTTPS media URLs in response media state.
- Preserve non-Linq behavior by rejecting unsupported media instead of silently dropping it.

## Verification

- Run package/typecheck and focused assistant CLI/engine checks required by the repo verification docs.
- Run required completion audits for standard repo code changes and external delivery behavior.

## Status

In progress.
Status: completed
Updated: 2026-06-07
Completed: 2026-06-07
