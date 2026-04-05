## Goal (incl. success criteria):
- Land the `review-gpt` session-home resolution fix so `thread wake` no longer false-matches transcript mentions across multiple Codex homes.
- Verify the package locally, cut the requested new patch release, and update Murph to consume that released version through the normal dependency flow.
- Keep Murph repo changes limited to the dependency bump, lockfile, dependency-policy metadata, and plan bookkeeping.

## Constraints/Assumptions:
- Preserve unrelated dirty worktree edits in Murph.
- Do not expose secrets or personal identifiers.
- Use the published-package import path in Murph rather than a file/url dependency.
- `../review-gpt` has its own AGENTS rules and requires `pnpm typecheck` and `pnpm test`; run `pnpm release:check` because the release version will change.

## Key decisions:
- Treat the bug as a package-level session ownership resolver defect, not as a one-off wake invocation failure.
- Tighten session ownership detection to exact ownership signals only instead of raw transcript substring matches.
- Implement and verify fixes in `../review-gpt` first, then cut a new version and bump Murph to that published version.

## State:
- in_progress

## Done:
- Reproduced and explained the false positive: an unrelated Codex home mentioned the target `sessionId` in transcript text and was treated as an owner.
- Patched `../review-gpt` to require exact session ownership signals when resolving a Codex home and added a regression test covering transcript-only mentions.
- Verified the local `review-gpt` fix with `pnpm release:check`.
- Released `@cobuild/review-gpt@0.5.38` from `../review-gpt`.
- Updated Murph to `@cobuild/review-gpt@^0.5.38`, refreshed the version-scoped `minimumReleaseAgeExclude` entry, refreshed the lockfile, and reinstalled workspace dependencies.
- Verified Murph with `pnpm deps:guard`, `pnpm deps:ignored-builds`, `pnpm exec cobuild-review-gpt thread wake --help`, `pnpm typecheck`, `pnpm test`, and `pnpm test:coverage`.

## Now:
- Run the final review, then close the plan and commit the scoped Murph dependency-bump files.

## Next:
- Hand off the released `0.5.38` bump with the verification evidence and the review-gpt cross-repo sync caveat.

## Open questions (UNCONFIRMED if needed):
- UNCONFIRMED: whether the sibling repos that failed the automatic `review-gpt` sync should be normalized onto the current pnpm store layout in a separate maintenance pass.

## Working set (files/ids/commands):
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- `agent-docs/exec-plans/active/2026-04-05-review-gpt-robustness-release.md`
- `../review-gpt/src/codex-session-lib.mts`
- `../review-gpt/test/chatgpt-thread-wake.test.mjs`
- `../review-gpt/package.json`
- `package.json`
- `pnpm-workspace.yaml`
- `pnpm-lock.yaml`
Status: completed
Updated: 2026-04-06
Completed: 2026-04-06
