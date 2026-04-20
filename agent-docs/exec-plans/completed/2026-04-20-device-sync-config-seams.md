## Title

Split `packages/device-syncd/src/config.ts` into seam-specific config modules while keeping `config.ts` as the public surface.

## Goal

Reduce `packages/device-syncd/src/config.ts` to a public compatibility surface by moving env-key constants, runtime config parsing, provider config readers, serializable provider-config codecs, and provider factory construction into focused modules under `packages/device-syncd/src/config/`.

## Scope

- `packages/device-syncd/src/config.ts`
- `packages/device-syncd/src/config/env-keys.ts`
- `packages/device-syncd/src/config/runtime-config.ts`
- `packages/device-syncd/src/config/provider-configs.ts`
- `packages/device-syncd/src/config/serializable-provider-configs.ts`
- `packages/device-syncd/src/config/provider-factory.ts`
- focused `packages/device-syncd/test/config.test.ts` updates only if import or behavior expectations require them

## Constraints

- Keep `packages/device-syncd/src/config.ts` as the package's public compatibility surface for this turn.
- Preserve behavior, exported symbols, and test expectations unless a narrow import adjustment is required by the refactor.
- Follow the requested move order: serializable codec seam first, then provider-specific readers, then the remaining seams.
- Do not broaden the change into downstream import cleanups outside `device-syncd`.

## Verification

- `pnpm typecheck`
- `bash scripts/workspace-verify.sh test:diff packages/device-syncd/src/config.ts packages/device-syncd/src/config packages/device-syncd/test/config.test.ts`
- `pnpm --dir packages/device-syncd test:coverage` if the diff-aware lane does not give truthful coverage for the touched owner

## Notes

- This is a structural refactor inside one package seam, not a behavior change.
- The active worktree already has unrelated edits in `packages/assistant-engine/src/assistant/system-prompt.ts`; preserve them untouched.
Status: completed
Updated: 2026-04-20
Completed: 2026-04-20
