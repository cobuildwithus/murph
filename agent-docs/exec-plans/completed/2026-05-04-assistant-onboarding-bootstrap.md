# Assistant Onboarding Bootstrap

## Goal

Make hosted assistant onboarding a bounded first-contact bootstrap instead of a durable per-turn mode. The assistant should receive onboarding guidance long enough to start a first conversation, then future turns should not re-inject the full starter flow merely because onboarding progress state remains open.

## Scope

- `packages/assistant-engine/src/assistant/**`
- `packages/assistant-engine/test/**`
- `packages/assistant-cli/src/commands/assistant.ts`
- assistant CLI tests if the onboarding completion command surface is removed

## Constraints

- Keep Codex native resume as the default continuity mechanism.
- Keep Murph-owned assistant/session state as operational source of truth for routing, diagnostics, outbox, and recovery.
- Do not add broad transcript replay or duplicate prompt state unless a specific fallback requires it.
- Remove the onboarding-complete CLI surface only if first-contact bootstrap no longer depends on model/tool-driven completion.

## Verification Plan

- Focused assistant-engine tests covering onboarding injection and provider planning.
- Assistant CLI command coverage updates if command surface changes.
- `pnpm --filter @murphai/assistant-engine test -- ...`
- `pnpm --filter @murphai/assistant-cli test -- ...` if CLI tests change.
- `pnpm --filter @murphai/assistant-engine typecheck`
- `pnpm --filter @murphai/assistant-cli typecheck` if CLI source changes.
- `pnpm --filter @murphai/murph typecheck` if generated CLI metadata changes.

## Current Result

- Replaced durable global onboarding-open prompt gating with a vault-scoped `onboarding/bootstrap/vault` marker plus a one-turn fallback only when no bootstrap marker can be resolved.
- Kept first-contact markers for delivery dedupe separate from bootstrap prompt eligibility.
- Removed the assistant `onboarding` CLI command group and removed the model instruction to complete onboarding via CLI.
- Propagated bootstrap marker doc IDs through shared plan and delivery finalization; bootstrap markers are written only for sent or directly returned responses, not queued delivery.
- Removed the legacy public onboarding-state module/export and operator-config onboarding result schemas.
- Three review agents found lifecycle/delivery/CLI cleanup issues; all findings were addressed.
- Focused tests and package typechecks are green.
Status: completed
Updated: 2026-05-04
Completed: 2026-05-04
