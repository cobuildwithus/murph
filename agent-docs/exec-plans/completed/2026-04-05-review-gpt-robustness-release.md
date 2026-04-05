## Goal (incl. success criteria):
- Land robustness fixes in `../review-gpt` for ChatGPT tab reuse, wake polling/export resilience, and stale blank-tab behavior.
- Validate the package locally, cut the requested new package release version, and update Murph to consume that released version through the normal dependency flow.
- Keep Murph repo changes limited to the dependency bump, lockfile, and any required dependency-policy metadata.

## Constraints/Assumptions:
- Preserve unrelated dirty worktree edits in Murph.
- Do not expose secrets or personal identifiers.
- Use the published-package import path in Murph rather than a file/url dependency.
- `../review-gpt` has its own AGENTS rules and requires `pnpm typecheck` and `pnpm test`; run `pnpm release:check` if release/package metadata changes.

## Key decisions:
- Treat the root causes as package-level browser-target and wake/export robustness issues, not just one-off watch failures.
- Implement and verify fixes in `../review-gpt` first, then cut a new version and bump Murph to that version.
- Keep the fix set behavior-preserving for existing CLI flows aside from improved tab reuse, cleanup, and wake resiliency.

## State:
- completed

## Done:
- Confirmed Murph originally depended on `@cobuild/review-gpt@^0.5.35`.
- Patched `../review-gpt` so `thread wake` only reuses same-thread `/c/<thread-id>` tabs, preserves the wake/export resiliency fixes, and leaves `review:gpt` on the open-new-tab-first draft flow.
- Verified `../review-gpt` with `pnpm typecheck`, `pnpm test`, and `pnpm release:check`.
- Released `@cobuild/review-gpt@0.5.37` and confirmed npm publication before bumping Murph.
- Updated Murph to `@cobuild/review-gpt@^0.5.37` and refreshed the version-scoped `minimumReleaseAgeExclude` entry.
- Verified Murph with `pnpm deps:guard`, `pnpm deps:ignored-builds`, `pnpm typecheck`, and `pnpm exec cobuild-review-gpt thread wake --help`.
- Reproduced a pre-existing Murph verification hang in `pnpm test`, isolated `pnpm --dir apps/cloudflare verify`, and `pnpm test:coverage`, all stalling after `apps/cloudflare` reaches `pnpm test:node`.

## Now:
- Finish the required audit pass and commit the Murph dependency-bump files.

## Next:
- Hand off the released `0.5.37` bump with the Murph verification evidence and the pre-existing cloudflare test-hang caveat.

## Open questions (UNCONFIRMED if needed):
- UNCONFIRMED: why `apps/cloudflare` leaves `verify-fast.sh -> pnpm test:node -> vitest` idle instead of exiting after tests complete; the hang reproduced before any Murph source edits and with only the dependency bump present.

## Working set (files/ids/commands):
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- `agent-docs/exec-plans/active/2026-04-05-review-gpt-robustness-release.md`
- `../review-gpt/src/chatgpt-thread-lib.mts`
- `../review-gpt/src/chatgpt-thread-snapshot-lib.mts`
- `../review-gpt/src/chatgpt-thread-wake-lib.mts`
- `../review-gpt/src/prepare-chatgpt-draft.js`
- `../review-gpt/test/**`
- `../review-gpt/README.md`
- `../review-gpt/CHANGELOG.md`
Status: completed
Updated: 2026-04-05
Completed: 2026-04-05
