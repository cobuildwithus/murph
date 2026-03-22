# Assistant Session Drift Hardening

## Goal

Make assistant chat/session resume failures caused by missing local session files easier to diagnose and less disruptive, especially when a live Ink chat still has enough in-memory state to continue safely.

## Scope

- Trace the local assistant session resolution path around explicit `--session` resume and live Ink chat turns.
- Add narrow hardening for missing-session drift in:
  - `packages/cli/src/assistant/store.ts`
  - `packages/cli/src/assistant/store/persistence.ts`
  - `packages/cli/src/assistant/service.ts`
  - `packages/cli/src/assistant/ui/ink.ts`
- Add focused regression tests in `packages/cli/test/assistant-state.test.ts` and `packages/cli/test/assistant-service.test.ts`.

## Constraints

- Preserve current provider-session recovery semantics and explicit local-session ids.
- Do not broaden the change into unrelated assistant UI copy or provider transport behavior.
- Keep vault/home-path redaction intact in surfaced diagnostics.

## Verification

- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
