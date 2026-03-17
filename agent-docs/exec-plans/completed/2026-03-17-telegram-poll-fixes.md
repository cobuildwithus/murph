# Telegram poll durability and local-file fixes

Status: completed
Created: 2026-03-17
Updated: 2026-03-17

## Goal

- Make the Telegram inbox connector acknowledge updates only as local persistence advances, support local Bot API absolute file paths during attachment hydration, and surface async watcher failures promptly.

## Success criteria

- Telegram backfill advances source-native checkpoints page-by-page instead of draining multiple Bot API pages before local persistence completes.
- Local Bot API `getFile` responses that return absolute `file_path` values are downloaded from disk directly.
- Async failures inside the Telegram poll watch loop reject the watch call without waiting for shutdown.
- Regression tests cover the new backfill and watcher-failure behavior, and Telegram docs describe the new semantics.

## Scope

- In scope:
- `packages/inboxd` Telegram/chat poll connector behavior, focused regression tests, and Telegram-facing package/docs updates
- active execution-plan and ledger updates required by repo workflow
- Out of scope:
- CLI/runtime configuration follow-ups for `resetWebhookOnStart` or `downloadAttachments`
- introducing `@grammyjs/runner` or broader Telegram runtime changes

## Constraints

- Preserve unrelated dirty worktree edits and stay within the inboxd Telegram lane.
- Keep the implementation additive and deterministic with explicit failure paths.
- Run the completion workflow audit passes plus required verification before handoff.

## Risks and mitigations

1. Risk: backfill pagination can loop forever if a driver repeats the same cursor or returns empty capture sets.
   Mitigation: stop when a page emits no captures or the serialized cursor does not advance.
2. Risk: direct local file reads could mis-handle remote relative Telegram file paths.
   Mitigation: branch only for absolute filesystem paths or `file://` URLs and keep the existing remote fetch path unchanged otherwise.
3. Risk: watcher shutdown can mask real polling failures.
   Mitigation: race abort against an explicit watcher `done` promise and still close the watcher in a `finally` block.

## Tasks

1. Update the generic chat poll connector to advance checkpoints page-by-page and honor watcher completion promises.
2. Update the Telegram driver to fetch a single `getUpdates` page for backfill and support local file-path downloads.
3. Add focused regression tests and docs updates, then run the audit and verification workflow.

## Decisions

- Keep the existing `Api`-based Telegram transport and limit this change to durability and attachment handling fixes.
- Use a generic optional `done` promise on watcher handles so polling transports can surface async failures without a Telegram-specific API.

## Verification

- Commands to run:
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
- Expected outcomes:
- the required repo checks pass on the final tree, or any unrelated pre-existing blocker is documented with a defensible causal separation
Completed: 2026-03-17
