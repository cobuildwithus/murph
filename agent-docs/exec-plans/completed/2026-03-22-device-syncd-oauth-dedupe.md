# Device-syncd OAuth/session helper dedupe

Status: completed
Created: 2026-03-22
Updated: 2026-03-22

## Goal

- Reduce duplicated low-level OAuth/session plumbing between the Oura and WHOOP providers by reusing the existing shared OAuth module, without introducing a provider framework or obscuring provider-specific policy.

## Success criteria

- Clearly duplicated helper logic for token expiry calculation, scope parsing, token-response normalization, and the mutable refreshable API session is shared.
- Oura- and WHOOP-specific policy remains local and readable:
- Oura personal-scope enforcement
- WHOOP offline-scope / refresh fallback behavior
- provider-specific profile fetches, revoke behavior, webhook behavior, and job payloads
- Pagination stays provider-local unless a tiny shared helper is obviously clearer.
- Targeted provider/http tests and device-syncd typecheck are run.

## Scope

- In scope:
- `packages/device-syncd/src/providers/shared-oauth.ts`
- `packages/device-syncd/src/providers/oura.ts`
- `packages/device-syncd/src/providers/whoop.ts`
- targeted tests in `packages/device-syncd/test/{oura-provider,whoop-provider,http}.test.ts`
- this plan and the coordination ledger while the lane is active
- Out of scope:
- provider-specific pagination abstraction unless it remains tiny and clearer than the local code
- broader device-syncd architecture changes
- control-plane HTTP trust-boundary work already in flight elsewhere

## Constraints

- Keep helpers narrow and obvious; no provider framework.
- Stop and report instead of extracting logic that hides token-policy or pagination differences.
- Preserve overlapping edits already present in the worktree.

## Risks and mitigations

1. Risk: shared token helpers could blur provider-specific error codes/messages.
   Mitigation: keep provider-specific error factories local and pass them into narrow shared helpers.
2. Risk: shared session wiring could accidentally change refresh/retry semantics.
   Mitigation: preserve the current `requestWithRefreshAndRetry` behavior and only centralize the mutable account/update wrapper.
3. Risk: pagination looks similar but differs enough to become harder to read when shared.
   Mitigation: leave pagination provider-local unless the extraction is trivially smaller and clearer.

## Tasks

1. Extract narrow shared OAuth helpers for expiry/scope/token normalization and refreshable API sessions.
2. Rewire Oura and WHOOP to use those helpers while keeping policy differences local.
3. Run device-syncd typecheck plus the targeted Oura/WHOOP/http tests.
4. Close the plan and remove the ledger row when the lane is done.

## Decisions

- Treat token-response normalization as shareable only if provider-specific error reporting stays local through injected callbacks.
- Treat refresh-token policy as provider-local unless the shared helper remains obviously simpler than the current inline code.
- Keep pagination local unless the final shared helper would be smaller than both current loops combined and still more readable.

## Verification

- Commands to run:
- `pnpm --dir packages/device-syncd typecheck`
- `pnpm --dir ../.. exec vitest run packages/device-syncd/test/oura-provider.test.ts packages/device-syncd/test/whoop-provider.test.ts packages/device-syncd/test/http.test.ts --no-coverage`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
- Expected outcomes:
- typecheck passes
- targeted Oura/WHOOP/http tests pass
- root checks may still expose unrelated pre-existing repo failures outside this device-syncd lane

## Outcomes

- Shared `isoFromExpiresIn`, `splitScopes`, `isTokenNearExpiry`, `tokenResponseToAuthTokens`, and `createRefreshingApiSession` now live in `shared-oauth.ts`.
- Oura and WHOOP now reuse the shared token/session helpers while keeping refresh-token policy and pagination local.
- Pagination remained provider-local intentionally because the Oura and WHOOP collection/query shapes differ enough that a shared loop would be less clear.
- Verification:
- `pnpm --dir packages/device-syncd typecheck` passed.
- `pnpm --dir ../.. exec vitest run packages/device-syncd/test/oura-provider.test.ts packages/device-syncd/test/whoop-provider.test.ts packages/device-syncd/test/http.test.ts --no-coverage` passed.
- `pnpm typecheck` failed for a pre-existing `packages/core/src/bank/allergies.ts` syntax error.
- `pnpm test` failed at the repo doc-drift gate because `agent-docs` changes are already present in the worktree outside this lane.
- `pnpm test:coverage` failed on pre-existing repo build/type errors in `packages/core`, `packages/importers`, and `packages/cli`.
Completed: 2026-03-22
