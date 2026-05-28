# Hosted Runner Warm Auth Recovery

## Goal

Fix hosted runner wake failures where a warm Cloudflare container reports HTTP 401 on the private control health check, then exits during active work.

## Scope

- Diagnose local hosted runner state using metadata-only database and Docker/runtime checks.
- Keep the worker/container control-token boundary fail-closed.
- Add focused regression coverage for stale warm-shell control-token recovery.

## Constraints

- Do not print local env secrets, raw mailbox payloads, raw logs with message content, or direct personal identifiers.
- Preserve unrelated active hosted runner and Murph Age working-tree edits.
- Avoid broad runtime refactors; this task is a targeted recovery fix.

## Verification

- Focused hosted runner tests covering the stale warm control-token path.
- Required Cloudflare/app verification selected from `agent-docs/operations/verification-and-runtime.md`, unless blocked by unrelated active work.

## State

- Active investigation.
