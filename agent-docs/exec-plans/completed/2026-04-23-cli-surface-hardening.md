# CLI Surface Hardening

## Goal

Prevent unsupported or malformed CLI inputs from reaching runtime services where they can turn into opaque hosted failures, and make assistant model configuration failures visible to the caller without advancing inbox cursors.

## Scope

- Shared CLI validation helpers for provider keys, base URLs, API-key env names, headers, and assistant channels.
- CLI command surfaces for device connections, wearable filters, assistant model/provider options, inbox model routing, and Mapbox route responses.
- Focused regression tests for rejected unsupported providers, malformed options, and retryable model-config failures.

## Out Of Scope

- New provider integrations.
- Hosted runtime database schema changes.
- Broad assistant behavior changes beyond failing fast on invalid operator configuration.

## Verification

- Focused package tests for touched surfaces.
- `pnpm typecheck`.
- Scoped diff verification with `scripts/workspace-verify.sh test:diff`.
- Required completion audit passes before handoff.

## Status

Completed. The final review found scanner cursor advancement and generated incur artifact freshness issues; both were fixed and covered before final verification.
Status: completed
Updated: 2026-04-23
Completed: 2026-04-23
