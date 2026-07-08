# Runner Boot Defer Connectors

## Goal

Remove the hosted conversation provider-connector graph from the hosted runner's
PRE-LISTEN module load path while preserving Telegram, Linq, WhatsApp, and
conversation turn behavior.

## Constraints

- Keep the fix minimal and package/composability-focused.
- Do not externalize `grammy` or add feature flags.
- Do not change fatal/shutdown drain path eagerness.
- Only move runtime connector values behind per-turn lazy imports when static
  analysis shows they are not needed at module evaluation time.

## Current State

- Implementation complete.
- Hosted conversation local-inbox projection is lazy-loaded from the
  conversation mailbox import path.
- Hosted runtime static inboxd imports use the existing
  `@murphai/inboxd/runtime` subpath instead of the root barrel.
- Runner entrypoint bundle guard now blocks provider connector inputs in the
  static boot closure while allowing dynamic chunks.

## Verification Plan

- Rebuild `apps/cloudflare` runner bundle and measure entry chunk bytes, total
  bundle bytes, and `grammy|node-fetch` entry references before and after.
- Run targeted runner bundle tests.
- Run touched `packages/assistant-runtime` tests and package/typecheck checks.

## Verification

- Before: entry `3,433,369` bytes; total `9,109,268` bytes; entry
  `grammy|node-fetch` matches `69`.
- After: entry `2,288,516` bytes; total `8,201,281` bytes; entry
  `grammy|node-fetch` matches `0`.
- `pnpm --dir apps/cloudflare runner:bundle` passed.
- Runner-bundle Vitest suite passed: 8 files, 68 tests.
- Focused assistant-runtime hosted conversation/idle/pending tests passed: 6
  files, 103 tests.
- `pnpm --dir packages/assistant-runtime typecheck` passed.
- `pnpm --dir packages/inboxd typecheck` passed.
- `pnpm --dir apps/cloudflare typecheck` passed.
- `pnpm --dir packages/inboxd verify:package-boundary:prepared` passed.
- `pnpm typecheck` passed.
Status: completed
Updated: 2026-07-06
Completed: 2026-07-06
