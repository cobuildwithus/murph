# Remove Hosted Runtime Host Deadline

## Goal

Remove the configured hosted runtime foreground host timeout and the deadline-driven checkpoint/shutdown machinery, while preserving idle checkpointing, scheduled wakes, startup readiness bounds, and container cleanup paths.

## Context

Production hosted runtime containers should not shut down solely because a host-side foreground deadline elapsed. Stuck or cycling containers are separate bugs to diagnose through state, alarms, and cleanup behavior instead of a blanket timeout.

## Scope

- Delete the runner foreground timeout environment settings and generated deploy output.
- Stop passing host-side deadlines into runtime jobs.
- Remove deadline-driven checkpoint decisions from assistant runtime foreground processing.
- Keep bounded readiness, web-control, commit, and idle lifecycle behavior.
- Update tests and durable docs to describe idle/scheduled-wake checkpointing without host-side deadline shutdown.

## Non-Goals

- No new lifecycle service, queue, or fallback timer.
- No schema migration for historical Durable Object columns unless required by tests or runtime correctness.
- No changes to Cloudflare platform lifecycle ownership beyond removing the app-level foreground deadline.

## Verification Plan

- `pnpm --filter @murphai/hosted-execution typecheck`
- `pnpm --filter @murphai/cloudflare-runner typecheck`
- `pnpm --filter @murphai/hosted-local-harness typecheck`
- Assistant-runtime typecheck/test once workspace build artifacts are available, or document unrelated build-output blockers.
- Focused Cloudflare, hosted-execution, assistant-runtime, and hosted-local-harness tests for touched behavior.
- `git diff --check`
- Required completion audits for high-risk hosted runtime work.

## Status

Implementation in progress. Host deadline env and runtime behavior are removed; verification and completion audits are next.
