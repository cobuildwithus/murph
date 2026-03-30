# 2026-03-30 assistantd watch follow-up

## Goal

Apply only the remaining assistantd follow-up fixes that are still genuinely applicable after inspecting the wake-thread export.

## Success Criteria

- Outbound assistant reply sanitization strips relative markdown file links and inline local-path references on outbound channels without changing local chat behavior.
- AssistantD HTTP coverage directly exercises `/open-conversation` and locks the `{ created, session }` contract.
- Repo-required verification is rerun and unrelated blockers are recorded separately.

## Scope

- `packages/cli/src/assistant/reply-sanitizer.ts`
- `packages/cli/test/assistant-service.test.ts`
- `packages/assistantd/test/http.test.ts`
- Coordination metadata for this lane

## Constraints

- Keep changes scoped to issues that still exist in the current tree after comparing the exported ChatGPT thread against local HEAD.
- Preserve the already-landed assistantd hardening work; do not reopen broader assistant/runtime refactors.
- Do not touch unrelated dirty files such as generated doc-inventory output.

## Verification

- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
- Focused assistantd/CLI regression tests around the changed surfaces

## Outcome

- The wake artifact did not contain a downloadable patch or diff. The exported thread only exposed attachment labels as button text with null hrefs, and the latest response was prose review rather than an attached patch payload.
- After comparing the review notes against local HEAD, most reported assistantd issues were already fixed in-repo.
- Applied only the two still-applicable follow-ups: stronger outbound sanitization for relative/bare local references and direct `/open-conversation` HTTP contract coverage.

## Verification Notes

- Passed: `pnpm --dir packages/assistantd typecheck`
- Passed: focused `packages/cli/test/assistant-service.test.ts` sanitizer/privacy cases
- `pnpm --dir packages/assistantd test` is blocked in this sandbox by `listen EPERM 127.0.0.1`
- `pnpm typecheck`, `pnpm test`, and `pnpm test:coverage` are blocked in this sandbox by `tsx` IPC `listen EPERM` before normal repo-wide checks complete
Status: completed
Updated: 2026-03-30
Completed: 2026-03-30
