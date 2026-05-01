# Cloudflare Runner Nudge Fix

## Goal

Apply and verify the supplied Cloudflare hosted runner nudge patch so follow-up inbound messages are coordinated by the per-user Durable Object wake path instead of the normal queue path.

Success criteria:

- `/internal/users/:userId/nudge` persists the nudge through the runner Durable Object without enqueueing a normal-path runner wake queue message.
- Idle Durable Object nudges start a runner drive immediately while keeping the alarm as recovery.
- Active runner invocations receive an explicit `inputAvailable` signal through runtime liveness and notify active turn input controllers.
- DO alarm and legacy queue fallback drains wait for any live in-isolate invocation before starting the follow-up drain.
- Active in-isolate nudges schedule an immediate alarm instead of heartbeat/orphan-grace recovery.

## Scope

- Cloudflare worker nudge route and runner DO RPC surface.
- Hosted runner alarm/active-lock scheduling.
- Runner wake queue fallback consumer.
- Focused Cloudflare unit coverage for nudge route, queue fallback, and active invocation wait behavior.

## Constraints

- Preserve the one-runner-per-user invariant.
- Keep the wake queue consumer for old queued messages and repair paths.
- Do not touch unrelated active device-sync, parser-toolchain, hosted web, or assistant-runtime rows in this dirty checkout.

## Verification Plan

- Focused Cloudflare node tests for nudge, heartbeat, worker ingress, runtime-platform parsing, and deploy workflow env alignment.
- Cloudflare package typecheck.
- Assistant runtime and assistant engine package coverage for the liveness/input-available bridge.
- Real hosted-local Linq rapid-follow-up E2E when the current dirty checkout can complete the runner scenario cleanly.
- `git diff --check` for touched Cloudflare files.

## Current Verification

- `git diff --check -- <task touched files>` passed.
- Focused Cloudflare node tests for nudge, heartbeat, worker ingress, runtime platform parsing, and deploy automation passed.
- `pnpm --dir apps/cloudflare verify` passed.
- `pnpm --dir packages/assistant-runtime typecheck` passed.
- `pnpm --dir packages/assistant-runtime test:coverage` passed.
- `pnpm --dir packages/assistant-engine typecheck` passed.
- `pnpm --dir packages/assistant-engine test:coverage` passed.
- Hosted-local Linq webhook E2E was attempted. Runner bundle setup and hosted smoke preflight passed, but the Vitest scenario stayed silent past the expected window and was terminated. Treat this as inconclusive direct scenario proof, not a failing wake assertion.

## Completion Audits

- Security/privacy review found no findings. Residual watch points: monitor detached DO drive failures, repeated no-op `inputAvailable` heartbeats, old queued fallback drains, and complete a clean hosted-local Linq webhook scenario later.
- Coverage-write review found no missing proof worth adding and made no edits.
- Task-finish review found one low docs issue in `apps/cloudflare/DEPLOY.md`; fixed by moving the native parser-toolchain note below the full Junction env var list.
Status: completed
Updated: 2026-05-01
Completed: 2026-05-01
