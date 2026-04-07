# 2026-04-08 Review-Gpt Release And Pro Watch

## Goal

- Publish the verified `@cobuild/review-gpt` wake-state fix as a new patch release.
- Pull that published version into Murph so the repo stops carrying the temporary local patch.
- Use the packaged watcher in `work-with-pro` watch-only mode for the provided ChatGPT thread.

## Scope

- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- `agent-docs/exec-plans/active/2026-04-08-review-gpt-release-and-pro-watch.md`
- `package.json`
- `pnpm-lock.yaml`
- `pnpm-workspace.yaml`
- `patches/@cobuild__review-gpt@*.patch`
- `output-packages/chatgpt-watch/**`

## Constraints

- The release/publish step is explicitly authorized by the user in this turn.
- Murph should consume the published package version rather than keep a long-lived local patch once the new release exists.
- The provided ChatGPT thread URL should be treated as `work-with-pro` watch-only unless the user explicitly asks for a nudge or follow-up prompt.
- Preserve unrelated history and worktree state.

## Plan

1. Run `review-gpt` release verification and publish the next patch version from the sibling owner repo.
2. Update Murph to the published version, remove the temporary pinned package patch, and verify the consumer repo.
3. Start a watch-only `thread wake` flow for `https://chatgpt.com/c/69d57e0d-5600-83a1-944c-bc00a8f39bcf` and confirm it is armed.

## Verification

- `../review-gpt`: `pnpm release:check`
- `../review-gpt`: `pnpm release:patch` published `@cobuild/review-gpt@0.5.51`
- `pnpm install`
- `pnpm install --frozen-lockfile`
- `pnpm typecheck`
- `pnpm --dir packages/cli exec vitest run test/release-script-coverage-audit.test.ts --no-coverage`
- `node --input-type=module -e "import { assistantSnapshotLooksIncomplete, snapshotBusyReason } from '@cobuild/review-gpt/dist/chatgpt-thread-lib.mjs'; ..."` -> `{"incomplete":true,"reason":"assistant-settling"}`
- `pnpm exec cobuild-review-gpt thread wake --delay 0s --poll-interval 1m --poll-timeout 120m --chat-url https://chatgpt.com/c/69d57e0d-5600-83a1-944c-bc00a8f39bcf --session-id \"$CODEX_THREAD_ID\" --output-dir output-packages/chatgpt-watch/69d57e0d-5600-83a1-944c-bc00a8f39bcf`
- Watch status confirmed in `output-packages/chatgpt-watch/69d57e0d-5600-83a1-944c-bc00a8f39bcf/status.json` with `completionStatus: "checked-once"` and `state: "waiting"`.
Status: completed
Updated: 2026-04-08
Completed: 2026-04-08
