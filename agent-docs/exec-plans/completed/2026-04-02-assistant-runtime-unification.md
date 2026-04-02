# Assistant Runtime Unification

## Goal

Implement the next assistant architecture simplification step by making providers share one Murph-owned orchestration path while preserving provider-native resume.

## Why now

- The current assistant runtime still branches by provider family for workspace mode, host-tool exposure, recovery, and transcript/session handling.
- Phase 0 fixed the false guard blocks, but the provider/runtime split that caused them still exists.
- The user explicitly asked to implement the shared-runtime follow-up thoroughly.
- Legacy prompt-version, workspace-key, and route-recovery compatibility state has now been hard-cut from the shared runtime path; the remaining work is the provider adapter/config split itself.

## Scope

- `packages/assistant-core/src/assistant/provider-turn-runner.ts`
- `packages/assistant-core/src/assistant/provider-config.ts`
- `packages/assistant-core/src/assistant/providers/**`
- Focused assistant session/config/runtime tests under `packages/cli/test/**`
- Matching architecture/security/process docs if the durable rules change

## Non-goals

- Removing provider-native resume entirely
- Deleting the canonical write guard in this same slice
- Broad hosted-runtime, onboarding, or message-routing behavior changes outside the provider/runtime seam

## Intended behavior

- Murph owns one assistant orchestration path across providers.
- Providers differ in transport/capability details, not in authority or runtime mode.
- Provider-native resume remains available as an adapter optimization rather than a separate runtime architecture.
- Direct-CLI-only workspace/config-override/recovery branching is removed or minimized so provider choice no longer reshapes the whole turn engine.

## Verification

- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
- Focused assistant runtime/provider scenario proof for the shared orchestration path
Status: completed
Updated: 2026-04-02
Completed: 2026-04-02
