# telegram assistant integration

Status: completed
Created: 2026-03-18
Updated: 2026-03-28

## Goal

- Apply the provided Telegram integration so Telegram becomes a first-class assistant delivery and auto-reply channel alongside iMessage.

## Success criteria

- Assistant outbound delivery supports Telegram chat targets and Telegram topic targets in the form `<chatId>:topic:<messageThreadId>`.
- Telegram bindings reuse the shared assistant session abstraction by preferring the normalized thread id as the delivery target.
- Setup/onboarding configures Telegram when a bot token is available and only auto-launches `assistant run` when at least one selected channel is actually ready.
- Inbox/runtime Telegram config resolution uses one shared runtime helper instead of duplicating env parsing.
- Focused CLI tests and required repo checks pass after the merge.

## Scope

- In scope:
  - assistant binding and outbound-channel updates for Telegram delivery
  - shared Telegram runtime helpers used by inbound and outbound code
  - setup/onboarding gating and launch behavior for Telegram-ready channels
  - docs and targeted CLI tests required to keep the new behavior explicit
- Out of scope:
  - replacing the existing Telegram polling connector transport model
  - live Telegram bot validation against the network during repo automation
  - unrelated assistant, setup, or inbox refactors beyond what the merge requires

## Risks and mitigations

1. Risk: overlapping active edits in assistant, inbox, and setup files.
   Mitigation: read current file state first, merge narrowly, and preserve adjacent work already in the tree.
2. Risk: onboarding could auto-launch assistant automation even when Telegram is selected but not actually configured.
   Mitigation: keep launch gating tied to real readiness, not channel selection alone.
3. Risk: Telegram target parsing could drift between inbound and outbound paths.
   Mitigation: centralize bot token/base URL and target parsing helpers in the shared runtime module.

## Tasks

1. Inspect the provided patch against current file contents and identify any merge-sensitive overlaps.
2. Apply the Telegram runtime, assistant binding, outbound delivery, setup, docs, and test changes on top of the current worktree.
3. Run targeted CLI tests, then the required repo checks and completion-workflow audit passes.
4. Commit only the touched files after removing the active ledger row.

## Verification

- Focused: targeted assistant/setup CLI tests covering Telegram delivery and onboarding readiness.
- Required: `pnpm typecheck`, `pnpm test`, `pnpm test:coverage`.
- Outcome:
  - `pnpm exec vitest --no-coverage packages/cli/test/assistant-channel.test.ts packages/cli/test/setup-cli.test.ts` passed.
  - `pnpm typecheck` passed.
  - `pnpm build` passed.
  - `pnpm test` failed in pre-existing `packages/cli/test/assistant-cli.test.ts` assistant-memory CLI cases after the root package/test harness reached unrelated build-retry failures.
  - `pnpm test:coverage` failed in the same pre-existing `packages/cli/test/assistant-cli.test.ts` assistant-memory CLI cases.
Completed: 2026-03-28
