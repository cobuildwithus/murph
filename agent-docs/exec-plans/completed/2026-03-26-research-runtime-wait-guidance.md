# Research Runtime Wait Guidance

## Goal

Make `vault-cli research` / `deepthink` clearer and more reliable for long-running ChatGPT runs by:
- confirming whether auto-send is already implied by the current `review:gpt` wrapper
- making Healthy Bob's wrapper intent explicit if needed
- updating agent/tool-facing guidance so operators and agents expect Deep Research waits that can stretch well past a few minutes

## Scope

- `packages/cli/src/research-runtime.ts`
- `packages/cli/src/commands/research.ts`
- `packages/cli/src/assistant-cli-access.ts`
- `packages/cli/src/assistant/service.ts`
- `packages/cli/src/vault-cli-command-manifest.ts`
- focused `packages/cli/test/{research-runtime,assistant-cli-access,assistant-service,incur-smoke}.test.ts`
- durable runtime docs only if the guidance belongs there as repo truth

## Constraints

- Preserve the current save-to-vault `research/` note contract.
- Keep `deepthink` behavior aligned with `research` unless a mode-specific wording or timeout default is clearly justified.
- Do not broaden the change into unrelated assistant-memory, meal, or setup guidance work already in flight.

## Success Criteria

- The wrapper behavior around send/wait is unambiguous in code and tests.
- Agent-facing guidance mentions that Deep Research can take tens of minutes and should be awaited unless the tool actually errors.
- CLI help/manifest text exposes the same expectation so schema/help consumers see it too.
- Focused tests cover the updated command args and guidance copy.

## Verification

- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
