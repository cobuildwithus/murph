# Hosted Local Checkpoint Window

Status: completed
Created: 2026-06-04
Updated: 2026-06-04

## Goal

- Prevent long interactive hosted-local Codex turns from losing compacted runner state before the idle checkpoint commits.

## Success criteria

- `pnpm dev` generated worker config uses a shorter local idle checkpoint delay by default.
- Explicit caller overrides still win.
- Focused hosted-local harness tests pass.

## Scope

- In scope: hosted-local harness dev config defaults, focused tests, and local harness docs.
- Out of scope: production Cloudflare worker defaults, assistant prompt changes, provider compaction logic, and runtime checkpoint protocol rewrites.

## Constraints

- Keep the change local-dev scoped and minimal.
- Preserve existing E2E profile overrides.
- Avoid overlapping active assistant-engine and CLI lanes.

## Risks and mitigations

1. Risk: Shorter local checkpoint timing could mask production timing assumptions.
   Mitigation: Apply only in generated hosted-local dev config; leave worker production defaults unchanged.

## Tasks

1. Add a hosted-local dev idle checkpoint default.
2. Add focused tests for the default and override behavior.
3. Document the local-dev default.
4. Run focused verification.

## Decisions

- Use 30000ms as the local interactive default so a long foreground turn has room to persist dirty state before local response closure.

## Verification

- Commands to run:
  - `pnpm --dir packages/hosted-local-harness test -- --runInBand`
  - `pnpm --dir packages/hosted-local-harness typecheck`

Completed: 2026-06-04
