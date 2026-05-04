# Runner Artifact Latency

## Goal

Reduce pre-assistant hosted runner latency by removing duplicated artifact uploads and repeated per-artifact authorization/crypto work without moving the typing boundary or changing assistant runtime semantics.

## Scope

- `apps/cloudflare/src/runtime-platform.ts`
- `apps/cloudflare/src/runner-outbound.ts`
- `apps/cloudflare/src/runner-outbound/shared.ts`
- Focused Cloudflare runner tests covering artifact upload dedupe, lease validation caching, and runtime crypto context caching.

## Constraints

- Keep artifact writes content-addressed and only skip duplicate SHA uploads after one successful upload in the same platform instance.
- Cache only successful artifact lease validation and keep the TTL short enough to preserve liveness/orphan detection behavior.
- Cache runtime crypto context by user and domain using the returned context TTL.
- Fail stale or malformed artifact writes before resolving runtime crypto.
- Do not broaden Cloudflare's hosted control surface or log sensitive payloads.

## Verification

- Focused `apps/cloudflare` runner tests.
- `apps/cloudflare` typecheck or package verify, depending on local runtime cost and unrelated branch state.
- Required security/privacy, coverage, and final review passes for hosted execution/trust-boundary work.
Status: completed
Updated: 2026-05-04
Completed: 2026-05-04
