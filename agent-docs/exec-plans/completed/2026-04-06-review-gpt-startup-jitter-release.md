## Goal (incl. success criteria):
- Add hidden initial polling jitter to `@cobuild/review-gpt thread wake` so concurrently started wake runs do not all hit ChatGPT at the same instant.
- Keep the CLI surface unchanged while making the wake flow more robust under several parallel watches.
- Release a new `@cobuild/review-gpt` version and update the sibling consumer repos that depend on it.

## Constraints/Assumptions:
- Preserve unrelated dirty edits in Murph, `../review-gpt`, and any other sibling repo touched for the dependency bump.
- Do not add new user-facing CLI options just to control startup jitter.
- Keep the jitter behavior simple, bounded, and consistent with the existing poll-jitter model.

## Key decisions:
- Implement startup jitter as an internal wake-flow behavior rather than adding another CLI flag.
- Reuse the existing poll-jitter concept for the initial spread, but cap the hidden startup delay so wake still feels immediate.
- Verify the upstream package first, then release, then bump sibling repos to the published version.

## State:
- ready_to_close

## Done:
- Confirmed `thread wake` already has per-cycle poll jitter but no jitter before the first export attempt.
- Confirmed multiple parallel `--delay 0s` wake runs share the same browser endpoint with no cross-process coordination, so initial burst spreading is the simplest high-value hardening.
- Patched `../review-gpt` so polling runs add a bounded hidden startup spread before the first export, documented that behavior in help/readme text, and added regression coverage for both polling and one-shot modes.
- Verified upstream `review-gpt` with `pnpm typecheck`, `pnpm test`, and `pnpm release:check`.
- Released `@cobuild/review-gpt@0.5.41` from `../review-gpt` and confirmed npm visibility plus successful GitHub release workflow completion.
- Updated Murph, `murph-release`, `wire`, `indexer`, `interface`, `chat-api`, `cli`, and `v1-core` to `@cobuild/review-gpt@0.5.41`.
- Rebuilt/install-synced the touched consumer repos from their updated lockfiles and confirmed the installed `cobuild-review-gpt` binary resolves to `0.5.41` in each consumer repo.
- Verified Murph and `murph-release` dependency policy after the bump with `corepack pnpm deps:guard`.

## Now:
- Close the Murph plan and commit the scoped dependency bump files.

## Next:
- None.

## Open questions (UNCONFIRMED if needed):
- None.

## Working set (files/ids/commands):
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- `agent-docs/exec-plans/active/2026-04-06-review-gpt-startup-jitter-release.md`
- `../review-gpt/src/chatgpt-thread-wake-lib.mts`
- `../review-gpt/test/**`
- `../review-gpt/package.json`
- `pnpm typecheck`
- `pnpm test`
- `pnpm release:check`
- `pnpm release:patch`
Status: completed
Updated: 2026-04-06
Completed: 2026-04-06
