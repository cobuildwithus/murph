# Gateway core route contract hardening

Status: completed
Created: 2026-04-24
Updated: 2026-04-24

## Goal

- Fix the reported gateway-core route/id/contract drift so opaque ids, Linq reply delivery, and send-message text validation have one shared behavior across local and hosted consumers.

## Success criteria

- Delimiter-free raw route keys no longer get silently accepted as route tokens by gateway id helpers.
- Explicit Linq participant reply routes are either consistently accepted or consistently rejected by inference, delivery serialization, and sendability helpers.
- Shared send-message input validation rejects whitespace-only text.
- Focused gateway-core tests cover all three reported risks.
- Required verification and completion audit passes are completed or any unrelated blocker is documented.

## Scope

- In scope:
  - `packages/gateway-core/src/{opaque-ids,reply-routes,routes,contracts}.ts`
  - Directly coupled `packages/gateway-core/test/**`
  - Directly coupled `packages/gateway-local/test/send.test.ts` route-token expectation
- Out of scope:
  - Runtime adapter behavior outside `@murphai/gateway-core`
  - Gateway-local persistence, hosted Cloudflare gateway projections, and provider webhook handling

## Constraints

- Technical constraints:
  - Preserve public package boundaries and avoid cross-package internals.
  - Keep the route vocabulary transport-neutral and deterministic.
- Product/process constraints:
  - Preserve unrelated dirty work in the shared checkout.
  - Use the gateway-core verification lane from `agent-docs/operations/verification-and-runtime.md`.

## Risks and mitigations

1. Risk: Tightening route token handling could break callers that pass legacy delimiter-free tokens.
   Mitigation: Make the new accepted token namespace explicit and version-prefixed, while continuing to hash raw route keys through the existing helper.
2. Risk: Linq route behavior remains split between helpers.
   Mitigation: Add a single test that exercises inference, delivery conversion, and sendability for the same explicit route.

## Tasks

1. Inspect current gateway-core route/id/contracts implementation and tests.
2. Implement the three reported behavior fixes.
3. Add focused tests for id token namespace separation, Linq participant semantics, and non-blank send text.
4. Update directly coupled gateway-local send expectation for normalized route-token idempotency.
5. Run package-local and repo-required verification.
6. Run required completion audit passes, fix any findings, then close and commit the plan.

## Decisions

- Use `gwrt1_` as the current verifiable route-token namespace.
- Keep existing `createGateway*` helpers compatible with route keys plus current prefixed tokens, and add explicit `createGateway*FromRouteToken` helpers for consumers that already hold a token.
- Make Linq thread-only at inference time; explicit participant delivery returns no delivery target instead of being rejected later by `gatewayConversationRouteCanSend()`.

## Verification

- Commands to run:
  - `pnpm --dir packages/gateway-core test:coverage`
  - `pnpm --dir packages/gateway-core typecheck`
  - `pnpm --dir packages/gateway-local test`
  - `pnpm --dir packages/gateway-local typecheck`
  - `pnpm typecheck`
  - `git diff --check`
- Expected outcomes:
  - Focused package coverage and repo typecheck pass, or unrelated blockers are documented with focused green proof.
- Current outcomes:
  - `pnpm --dir packages/gateway-core test:coverage` passed before and after the downstream test expectation update.
  - `pnpm --dir packages/gateway-core typecheck` passed before and after the downstream test expectation update.
  - `pnpm --dir packages/gateway-core test` passed.
  - `pnpm --dir packages/gateway-local test` passed after updating the directly coupled idempotency-token expectation.
  - `pnpm --dir packages/gateway-local typecheck` passed.
  - Focused CLI gateway-core Vitest (`pnpm exec vitest run packages/cli/test/gateway-core.test.ts --config vitest.config.ts --no-coverage`) passed.
  - `git diff --check -- <touched gateway/plan files>` passed.
  - Initial `pnpm typecheck` passed `packages/gateway-core` and failed later in unrelated dirty `packages/assistant-engine/src/assistant/outbox/dispatch-state.ts` and `packages/assistant-engine/src/assistant/providers/openai-compatible.ts` missing-name errors.
  - Final `pnpm typecheck` passed `packages/gateway-core` and `packages/gateway-local`, then failed later in unrelated dirty `packages/assistant-runtime/src/hosted-runtime/parsers.ts` and `packages/assistant-runtime/test/hosted-runtime-test-helpers.ts` missing `managedAutoReplyChannels` fields.
  - Scoped `bash scripts/workspace-verify.sh test:diff <gateway-core touched files>` failed in unrelated dirty `packages/cli` test type errors after broadening to reverse dependents.
  - Required `coverage-write` pass found no missing test gap and made no changes.
  - Required `task-finish-review` found one medium decoded-route-token validation gap; fixed by validating decoded envelope route tokens and adding crafted `gwcs_`, `gwcm_`, and `gwca_` envelope tests.
Completed: 2026-04-24
