# Multimodal Review Followups

## Goal

Address read-only subagent findings from the hosted foreground media context change.

## Scope

- Reap parser command descendants on nonzero exits.
- Add hosted Linq image attachment regression coverage.
- Tighten Codex app-server detached process cleanup for interrupts/process exit.
- Keep the hosted Codex E2E shim aligned with real Codex local-image forwarding.
- Preserve PDF deferral and audio transcript prompt coverage.

## Constraints

- Preserve unrelated dirty worktree edits and active coordination rows.
- Keep media payloads and local paths out of durable docs/logs.

## Verification Plan

- Focused parser, assistant-engine, assistant-runtime, and Linq webhook E2E checks.
- Typecheck touched packages.

## State

- Status: ready for closeout
- Started: 2026-05-10

## Notes

- Targeted parser, assistant-engine, assistant-runtime, and Cloudflare typechecks pass.
- Focused parser, assistant-engine Codex, hosted Codex shim, and hosted Linq audio ingestion tests pass.
- Hosted-local Linq E2E with `--no-bundle` reached the provider path and passed the image/PDF assertions; the audio transcript assertion failed against the stale bundle. A full bundle rebuild retry was blocked by a concurrent hosted-local runner-bundle lock.
Status: completed
Updated: 2026-05-11
Completed: 2026-05-11
