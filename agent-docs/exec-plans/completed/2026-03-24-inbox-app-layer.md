# Inbox App Layer Extraction

## Goal

Move inbox orchestration out of `packages/cli/src/inbox-services.ts` into a command-neutral app layer without changing the public `createIntegratedInboxCliServices` contract or inbox command behavior.

## Scope

- `packages/cli/src/inbox-services.ts`
- new `packages/cli/src/inbox-app/**`
- touched `packages/cli/src/inbox-services/{connectors,daemon,parser,promotions,query,state,shared}.ts`
- `packages/cli/src/index.ts` if exports need rewiring
- focused inbox CLI/tests for bootstrap/setup/doctor, runtime ops, reads, and promotions

## Non-Goals

- Do not change inbox command arguments or result shapes.
- Do not move inbox orchestration into a new published workspace package in this slice.
- Do not reshape connector/runtime behavior beyond what is required to move ownership into the app layer.
- Do not rewrite active Linq integration or canonical promotion semantics.

## Invariants

- `createIntegratedInboxCliServices` remains the public compatibility entry point.
- CLI-only concerns stay at the adapter edge; capability modules stay command-neutral.
- Preserve existing error codes/messages, daemon state behavior, parser integration, and promotion idempotency.
- Preserve current active Linq endpoint/account validation and bootstrap/setup behavior.

## Plan

1. Extract shared inbox runtime/service types away from `inbox-services.ts` so helper modules stop depending on the giant file for type ownership.
2. Split orchestration into capability modules: sources/bootstrap-doctor, runtime ops, reads/attachments, promotions.
3. Reduce `inbox-services.ts` to a thin compatibility surface that re-exports the service contract and delegates to the app-layer factory.
4. Run focused inbox regressions first, then the required repo-wide checks, and record any unrelated blockers before commit.

## Verification

- `pnpm exec vitest run --no-coverage packages/cli/test/inbox-cli.test.ts packages/cli/test/cli-expansion-inbox-attachments.test.ts packages/cli/test/inbox-model-route.test.ts packages/cli/test/canonical-mutation-boundary.test.ts`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
- completion workflow audit passes: `simplify` -> `task-finish-review` (with coverage/proof-gap review folded into the final audit)
