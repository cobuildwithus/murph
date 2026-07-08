# Codex Fresh-Thread Retry After Provider Actions

## Goal

Prefer graceful recovery for resumed Codex transport failures by allowing
Murph's fresh-thread fallback even when the failed resumed turn has already
emitted provider actions.

Success criteria:

- Remove the `providerActionCount === 0` requirement from the resumed transport
  failure fresh-thread fallback gate.
- Keep the fallback limited to transport/RPC failures and existing invalid-output
  handling.
- Update focused tests to document the accepted side-effect replay tradeoff.
- Run focused assistant-engine verification.

## Constraints

- User explicitly accepts the duplicate-side-effect risk for this rare failure
  path.
- Preserve Codex-native stream retry behavior and hosted `stream_max_retries = 5`.
- Do not broaden retry handling to non-transport model/provider errors.
- Preserve unrelated working-tree edits.

## Working Set

- `packages/assistant-engine/src/assistant/providers/codex-cli.ts`
- `packages/assistant-engine/test/codex-runtime-helpers.test.ts`

## State

- Current code fresh-thread retries resumed transport failures only when
  `providerActionCount === 0`.
- Production symptom had `stream-disconnected`, `willRetry=false`, and
  `providerActionCount=1`, which made Murph return a terminal failure.
- Chosen policy: recover from these resumed transport failures with a fresh
  thread even if earlier provider actions may have had side effects.

## Verification

- `pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts --no-coverage test/codex-runtime-helpers.test.ts -t "fresh-thread retries resumed Codex transport failures after provider actions"`
  passed.
- `pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts --no-coverage test/codex-runtime-helpers.test.ts`
  passed.
- `pnpm --dir packages/assistant-engine typecheck` passed.
- `pnpm --dir packages/assistant-engine test` passed.
Status: completed
Updated: 2026-07-07
Completed: 2026-07-07
