# PR 213 ReviewGPT round 10

## Goal

Fix the accepted PR 213 review findings before merge:

1. Persist accepted `finish_without_reply` completions durably per delivery
   context before the tool call is acknowledged, and materialize transcript
   markers on all terminal paths, including provider failure and steered turns.
2. Finish collapsing the abandoned one-member outbox variant architecture back
   to a flat message-intent contract without a serialized `kind` discriminator.

Success means focused assistant/outbox tests pass, the PR branch is pushed, and
the external PR review loop can continue from this head.

## Constraints / Assumptions

- Work on PR 213 branch `codex/reactions`.
- Preserve assistant runtime ownership: completion evidence remains non-canonical
  assistant runtime state, not product truth.
- Do not reintroduce reaction variants, new persisted tables, or compatibility
  shims.
- Do not expose secrets, local account identifiers, home-directory paths, or
  sensitive payloads in committed artifacts.

## Key decisions

- Persist accepted no-reply completions as transcript markers immediately from
  the provider callback, before native resume invalidation and before returning
  tool success.
- Include `turnId` and delivery-context ordinal in no-reply markers; dedupe by
  turn id with legacy timestamp fallback.
- Keep outbox intents as a single flat message schema and payload with no
  variant discriminator.

## State

Implementation complete; ready for commit and push.

## Done

- Read repo routing, security, reliability, and relevant package docs.
- Captured ReviewGPT round 10 findings from the user-provided response.
- Added durable no-reply marker persistence for local and notification turns,
  including provider failure and steered-turn paths.
- Ensured deferred user prompts are persisted before no-reply markers.
- Flattened the outbox message intent contract and hosted delivery payload.
- Added focused regression coverage for no-reply acceptance ordering, failure
  materialization, steered delivery contexts, marker dedupe, notification turns,
  and flat outbox parsing.
- Ran required audits: security/privacy, coverage-write, and deep review. Fixed
  the accepted prompt-order and turn-id dedupe findings.
- Verification passed:
  `pnpm exec vitest run packages/assistant-engine/test/assistant-codex-runtime.test.ts packages/assistant-engine/test/assistant-local-service-runtime.test.ts packages/assistant-engine/test/assistant-service-runtime.test.ts packages/assistant-engine/test/assistant-notification-turn-runtime.test.ts`;
  `pnpm typecheck`; `git diff --check`; `pnpm test:smoke`;
  `pnpm test:diff -- <changed package files>`.

## Now

- Commit with `scripts/finish-task`, push the PR branch, and continue the
  external PR review loop.

## Next

- Push and check PR/review status.

## Open questions

- None.

## Working set

- `packages/assistant-engine/src/assistant-codex.ts`
- `packages/assistant-engine/src/assistant/local-service.ts`
- `packages/assistant-engine/src/assistant/notification-turn.ts`
- `packages/assistant-engine/src/assistant/turn-finalizer.ts`
- `packages/assistant-engine/src/assistant/outbox.ts`
- `packages/assistant-engine/src/assistant/runtime-state-service.ts`
- `packages/assistant-engine/src/assistant/outbox/dispatch-state.ts`
- `packages/operator-config/src/assistant-cli-contracts.ts`
- `packages/hosted-execution/src/side-effects.ts`
- `packages/assistant-runtime/src/hosted-runtime/callbacks.ts`
- focused assistant/outbox tests
Status: completed
Updated: 2026-06-18
Completed: 2026-06-18
