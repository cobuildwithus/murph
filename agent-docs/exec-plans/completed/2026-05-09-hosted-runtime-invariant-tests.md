# Hosted Runtime Invariant Tests

## Goal

Add focused invariant tests for hosted foreground checkpoint avoidance and deterministic
hosted delivery replay keys without broadening runtime architecture.

## Scope

- `packages/assistant-runtime/test/hosted-runtime-workspace-entrypoint.test.ts`
- `packages/assistant-engine/test/assistant-automation-runtime.test.ts`
- Narrow assistant automation result type/return-shape alignment required by
  existing current-turn delivery intent plumbing.
- Existing focused Cloudflare tests used as evidence for browser-vault scheduling,
  refresh preemption, and idle-checkpoint races.

## Constraints

- Test-only changes where possible; keep required runtime/source edits limited to
  type/default propagation for existing fields.
- Preserve existing hosted runtime, browser-vault, and delivery architecture.
- Preserve unrelated dirty worktree edits and active plan rows.
- Do not write personal identifiers, secret values, raw prompts, or private runtime payloads.

## Verification

- Focused assistant-runtime foreground checkpoint test.
- Focused assistant-engine deterministic replay-key tests for Linq and email.
- Focused Cloudflare browser-vault continuation, preemption, and idle checkpoint race tests.
- Package/root typecheck.
- Package coverage for affected assistant-engine and assistant-runtime packages.
- Scoped diff verification as the dirty worktree allows.

## State

Completed. Focused test additions are implemented; root typecheck and affected package
coverage pass. Scoped diff verification reaches unrelated pre-existing CLI document
meal test failures after affected package checks pass.
Status: completed
Updated: 2026-05-09
Completed: 2026-05-09
