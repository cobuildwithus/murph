# PR 213 ReviewGPT Round 4 Fixes

Status: completed
Created: 2026-06-18
Updated: 2026-06-18

## Goal

- Resolve accepted ReviewGPT round-4 high findings for PR 213 with narrow, maintainable fixes.

## Success Criteria

- A later explicit `finish_without_reply` remains the final action for the latest steered input, and any earlier completed answer is delivered through its original delivery context as a preceding segment.
- Existing assistant daemon outbox list/get message-intent endpoints remain wire-compatible with v1 clients while preserving internal v2 reaction support for newer code paths.
- Focused regression tests, scoped verification, commit/push, and the next ReviewGPT round complete.

## Scope

- In scope: final-action ordering around trailing steered answers and explicit no-reply patches; daemon outbox message-intent response serialization; focused regression tests.
- Out of scope: broad reaction architecture deletion until product/channel support is explicitly cut from this PR.

## Constraints

- Preserve simple existing assistant runtime boundaries; avoid new persisted state or protocol negotiation machinery unless strictly required.
- Preserve explicit no-reply semantics as a typed final action.
- Keep existing v1 outbox message responses compatible for rollback and mixed-version local clients.
- Keep ReviewGPT artifacts under `audit-packages/` uncommitted.

## Risks And Mitigations

1. Risk: a completed answer can be delivered through a later steered message target.
   Mitigation: prefer an explicit latest-ordinal final-action patch over promoting an older trailing candidate, and emit the older candidate as a preceding segment with its original ordinal.
2. Risk: daemon response normalization can silently break older CLI clients.
   Mitigation: serialize message outbox intents over the existing daemon endpoints in the v1 wire shape and prove with a base-compatible strict parser fixture.

## Tasks

1. Patch Codex App Server finalization ordering for trailing answer plus later no-reply.
2. Patch assistantd outbox list/get serialization for message intents.
3. Add focused regression tests for both high findings.
4. Run required audits, verification, commit, push, and continue ReviewGPT loop.

## Decisions

- Accepted ReviewGPT round-4 high findings for wrong-target trailing answer delivery and outbox wire compatibility.
- Deferred the repeated complexity-collapse suggestion to delete reaction plumbing because the current product direction keeps the capability as dormant/unadvertised until a channel supports it; the high findings can be fixed without broad deletion.

## Verification

- `pnpm --dir packages/assistant-engine typecheck` passed.
- `pnpm --dir packages/assistantd typecheck` passed.
- `pnpm --dir packages/assistant-engine test -- assistant-codex-runtime.test.ts assistant-local-service-runtime.test.ts` passed.
- `pnpm --dir packages/assistantd test -- http.test.ts service-coverage.test.ts` passed.
- `pnpm --dir packages/assistant-cli typecheck` passed.
- `pnpm --dir packages/assistant-cli test -- assistant-daemon-client-owned-coverage.test.ts assistant-runtime-service-seams.test.ts` passed.
- `bash scripts/workspace-verify.sh test:diff` passed.
Completed: 2026-06-18
