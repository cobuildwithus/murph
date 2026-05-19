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
- `apps/cloudflare/src/runner-egress-intercept.ts`
- `apps/cloudflare/src/worker-contracts.ts`
- `apps/cloudflare/test/runner-egress-intercept.test.ts`
- `apps/web/test/hosted-workspace-store.test.ts`
- hosted runtime log event contract/tests
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
5. Add metadata-only egress diagnostics if the provider request path is
   correct but insufficiently observable.
6. Run focused verification for touched owners.

## Diagnostic Design Notes

- OpenAI Responses diagnostics live at the Cloudflare runner egress boundary
  and use the existing hosted runtime-log write path.
- Durable diagnostic payloads are metadata-only: counts, byte lengths,
  presence booleans, model/cache-retention kinds, and keyed fingerprints.
- Request/input/cache identifiers use HMAC-SHA256 fingerprints when
  `HOSTED_LOG_FINGERPRINT_SECRET` is configured; raw prompts, messages,
  request bodies, headers, secrets, cache keys, and previous response ids are
  not logged.
- Arbitrary request-body model strings collapse to `other` unless they are a
  small allowlisted public model kind.
- `waitUntil` is an optional scheduler only. When the container outbound path
  lacks it, the provider fetch starts before the diagnostic is awaited and the
  runtime log is still persisted.
- Full-body JSON parsing and full-body fingerprints are capped; prefix
  fingerprints remain bounded to fixed windows.

## Verification

- `pnpm exec vitest run packages/assistant-engine/test/codex-runtime-helpers.test.ts packages/hosted-execution/test/assistant-usage.test.ts` passed.
- `pnpm exec tsc --noEmit --pretty false --project packages/assistant-engine/tsconfig.json` passed.
- `pnpm exec tsc --noEmit --pretty false --project packages/hosted-execution/tsconfig.json` passed.
- `pnpm hosted-local e2e codex-gateway-prefix --profile e2e:live` passed.
- `pnpm typecheck` stopped on a pre-existing repo tools/contracts export mismatch in `scripts/verify.ts` before reaching touched package failures.
- `pnpm test` reached broad Repo Vitest, opened an interactive setup prompt, and was terminated; focused tests above cover the changed usage parsing.
- `pnpm --dir apps/cloudflare exec vitest run --config vitest.node.workspace.ts test/runner-egress-intercept.test.ts` passed.
- `pnpm --dir packages/hosted-execution exec vitest run --config vitest.config.ts test/hosted-runtime-control.test.ts` passed.
- `pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/test/hosted-workspace-store.test.ts` passed.
- `pnpm --dir apps/cloudflare typecheck` passed.
- `pnpm --dir packages/hosted-execution typecheck` passed.
- `pnpm --dir apps/web typecheck` passed.
- `pnpm logs:guard` passed.
