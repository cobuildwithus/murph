# Cloudflare Runner Wake Queue

## Goal

Replace the direct nudge-route background runner invocation with a Cloudflare Queue-backed wake trigger. The per-user Durable Object remains the source of truth for pending nudges, leases, in-flight state, alarms, and retry scheduling.

## Scope

- Add a runner wake queue producer binding and queue consumer in `apps/cloudflare`.
- Keep `POST /internal/users/:userId/nudge` fast: persist the nudge/alarm fallback, enqueue an immediate wake message when the runner is idle, and return the existing nudge response.
- Move long-running runner invocation ownership out of request `waitUntil`.
- Preserve the Durable Object alarm fallback and idempotent `runUntilIdleOrBudget` behavior.
- Add focused tests for enqueue, already-running skip, queue consumer run, and retry behavior.

## Out Of Scope

- No hosted web producer changes.
- No assistant-runtime behavior changes.
- No Cloudflare container/runtime image changes.
- No full hosted runtime architecture reshaping beyond this wake delivery rail.

## Verification

- Focused Cloudflare route/queue tests.
- Cloudflare typecheck or the narrowest truthful scoped check if unrelated dirty work blocks broader commands.
- Privacy/security review because this touches an authenticated internal runtime surface and background execution.
Status: completed
Updated: 2026-04-29
Completed: 2026-04-29
