# Runner Lifecycle Diagnostics

## Goal

Add minimal metadata-only diagnostics for hosted-local runner container deaths and restarts so the next `pnpm dev` incident can distinguish idle lifecycle cleanup, harness-driven cleanup, process poisoning, and unexpected container exit without exposing payloads or identifiers.

## Scope

- `apps/cloudflare` runner container lifecycle diagnostics and focused tests.
- No changes to Codex continuity snapshot semantics in the active continuity plan.
- No raw messages, prompts, transcripts, secrets, local absolute paths, or direct user identifiers in logs.

## Plan

1. Inspect runner lifecycle and dev/e2e harness cleanup paths.
2. Add a small structured diagnostic at the lifecycle boundary where current evidence disappears.
3. Cover the diagnostic with focused Cloudflare runner tests.
4. Run the scoped verification required for `apps/cloudflare` changes and completion reviews.

## Notes

- Current incident evidence points to a runner container exit close to the default idle TTL, followed by replacement restore from a null/bootstrap workspace.
- Assistant runtime docs already state that state since the last `idle_shutdown` checkpoint can be lost if the container dies first.
Status: completed
Updated: 2026-06-04
Completed: 2026-06-04
