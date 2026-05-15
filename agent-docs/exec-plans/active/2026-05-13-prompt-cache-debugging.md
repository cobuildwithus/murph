# Prompt Cache Debugging

## Goal

Find why recent Murph assistant turns appear not to receive OpenAI prompt-cache
hits, then make the smallest durable fix if the repo request path or usage
accounting is wrong.

## Success Criteria

- The OpenAI/Codex request path and usage parsing path are traced.
- Recent diagnostics are inspected only through redacted metadata.
- Any code fix preserves provider-secret and transcript privacy boundaries.
- Focused tests cover the root cause, or the blocker is documented with exact
  evidence.

## Scope

- `packages/assistant-engine/**`
- `packages/assistant-runtime/**`
- `packages/operator-config/**`
- `packages/cli/**`
- hosted Codex/OpenAI config surfaces if evidence points there
- focused provider usage and prompt-cache tests

## Out Of Scope

- Printing prompt/message/transcript contents.
- Pulling or exposing environment secrets.
- Broad provider migrations or model upgrades.
- Hosted deploy changes.

## Plan

1. Confirm current OpenAI prompt-caching requirements from official docs.
2. Trace request construction, state reuse, cache-key/retention settings, and
   usage parsing.
3. Inspect recent local runtime/provider diagnostics for cached-token metadata
   only.
4. Patch the smallest wrong layer if found.
5. Run focused verification for touched owners.

## Verification

- `pnpm exec vitest run packages/assistant-engine/test/codex-runtime-helpers.test.ts packages/hosted-execution/test/assistant-usage.test.ts` passed.
- `pnpm exec tsc --noEmit --pretty false --project packages/assistant-engine/tsconfig.json` passed.
- `pnpm exec tsc --noEmit --pretty false --project packages/hosted-execution/tsconfig.json` passed.
- `pnpm hosted-local e2e codex-gateway-prefix --profile e2e:live` passed.
- `pnpm typecheck` stopped on a pre-existing repo tools/contracts export mismatch in `scripts/verify.ts` before reaching touched package failures.
- `pnpm test` reached broad Repo Vitest, opened an interactive setup prompt, and was terminated; focused tests above cover the changed usage parsing.
