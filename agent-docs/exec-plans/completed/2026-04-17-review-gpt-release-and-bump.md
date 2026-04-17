## Goal (incl. success criteria):

Release a new `@cobuild/review-gpt` version that removes prompt-only review sends while preserving existing same-thread wake and recursive follow-up flows, then update `murph` to consume that published version.

## Constraints/Assumptions:

- Preserve unrelated dirty edits in `murph`.
- Treat `review-gpt` as the source-of-truth repo and `murph` as the downstream consumer.
- Existing wake helpers must keep working through the normal `pnpm review:gpt --send --chat-url ...` path after the package bump.
- Same-turn completion should include release, downstream bump, verification, and scoped commits.

## Key decisions:

- Remove prompt-only from the shared package itself instead of relying on repo-local wrappers.
- Keep wake/review helper behavior attachment-backed by default rather than inventing a new compatibility path.

## State:

in_progress

## Done:

- Confirmed `review-gpt` still exposes `--prompt-only`.
- Confirmed recursive wake helpers already use `pnpm review:gpt --send --chat-url ...` without `--prompt-only`.
- Confirmed `murph` currently depends on `@cobuild/review-gpt` `^0.5.65`.

## Now:

- Patch `review-gpt` CLI/docs/tests to remove prompt-only and keep wake guidance aligned.

## Next:

- Release a new `review-gpt` patch version.
- Update `murph` to the released version and verify the bump.

## Open questions (UNCONFIRMED if needed):

- UNCONFIRMED: whether release verification or publishing will surface any unrelated pre-existing blocker in the `review-gpt` repo.

## Working set (files/ids/commands):

- `../review-gpt/src/bin.mts`
- `../review-gpt/src/review-gpt-lib.mts`
- `../review-gpt/src/chatgpt-thread-wake-lib.mts`
- `../review-gpt/README.md`
- `../review-gpt/test/review-gpt.test.mjs`
- `../review-gpt/test/chatgpt-thread-wake.test.mjs`
- `package.json`
- `pnpm-lock.yaml`
Status: completed
Updated: 2026-04-17
Completed: 2026-04-17
