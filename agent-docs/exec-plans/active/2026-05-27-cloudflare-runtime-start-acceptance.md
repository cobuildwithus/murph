# Cloudflare Runtime Start Acceptance

Status: active
Created: 2026-05-27
Updated: 2026-05-27

## Goal

Make Cloudflare's `runtime_processing_accepted` response mean that the
per-user runner handoff was actually accepted by the container boundary, not
only that the Durable Object scheduled a background promise.

## Success Criteria

- Fresh runtime starts create the write fence, confirm the runner container can
  start and pass its health/readiness check, then return
  `runtime_processing_accepted`.
- If container startup/readiness cannot be confirmed, Cloudflare clears the
  fresh write fence and returns `retry_later` so Temporal owns the retry.
- Existing active-runtime wake behavior still returns accepted only when the
  active child accepts the wake.
- No new durable queue, callback plane, or orchestration owner is introduced.
- Focused Cloudflare runner tests and required repo checks pass, or unrelated
  blockers are recorded.

## Constraints

- Temporal remains the only durable hosted orchestration owner.
- Cloudflare owns only Durable Object runner coordination, write fences,
  container start/wake, and runtime callback authorization.
- Do not log raw payloads, prompts, message text, health data, provider
  responses, secrets, local paths, or raw identifiers.

## Working Set

- `apps/cloudflare/src/user-runner.ts`
- `apps/cloudflare/src/runner-container.ts`
- `apps/cloudflare/test/user-runner-alarm.test.ts`
- `apps/cloudflare/test/runner-container.test.ts`
- focused docs only if the runtime contract needs wording updates
