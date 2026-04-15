# 2026-04-10 iMessage Decommission

## Goal

Remove live iMessage support from Murph across inbox runtime, assistant delivery, setup/CLI surface, package topology, and current-facing docs under the current greenfield assumption.

## Scope

- Remove iMessage from live source/channel enums, setup defaults, assistant delivery, inbox runtime startup, package manifests, workspace topology, and docs/site/legal copy.
- Delete the `packages/inboxd-imessage` workspace package and supporting operator-config readiness surface.
- Remove the temporary migration readers and legacy tests that only existed to prune historical `imessage` state.

## Constraints

- Preserve unrelated in-flight scheduler and wearable work already present in the tree.
- Do not rewrite historical release notes or completed execution plans.
- Keep verification truthful and scoped while the tree has unrelated active edits.

## Plan

1. Remove live assistant, inbox, setup, CLI, build, and docs surfaces that still expose iMessage.
2. Remove the temporary inbox/assistant migration shims now that the branch is greenfield.
3. Rewrite or delete stale tests that depended on removed live iMessage behavior.
4. Run targeted verification, coverage-bearing checks where required, audit passes, and commit only the scoped removal paths.

## Current Status

- Live runtime/setup/package/docs surfaces are removed in the current worktree.
- The temporary inbox/assistant persisted-state migration shims are removed under the greenfield assumption.
- Remaining literal `imessage` refs are limited to:
  - negative package-boundary assertions proving removed dependencies/exports stay gone
  - upstream Linq payload semantics where `service: "iMessage"` is provider data rather than Murph support
- Focused package verification is green. Root `pnpm typecheck` is still red in the separate auto-reply refactor lane (`packages/assistant-engine/test/assistant-automation-runtime.test.ts` stale `autoReplyPrimed` / `enabledChannels` expectations).
Status: completed
Updated: 2026-04-10
Completed: 2026-04-10
