# Device Sync Dynamic Context

Status: completed

## Goal

Land the supplied dynamic-context patch in an isolated PR branch so hosted
assistant turns can receive provider-agnostic runtime context about device-sync
reconnect-required states.

Success criteria:

- Assistant system prompt assembly accepts generic runtime dynamic context
  blocks and injects them before the normal context snapshot for both
  conversation and notification-decision turns.
- Hosted runtime builds a device-sync status block from the existing
  `deviceSyncPort.fetchSnapshot()` surface when a connected source/account
  needs reconnect, including Junction source-slug to reconnect-target mapping.
- Weekly health digest guidance recognizes reconnect-required source errors and
  uses the supported reconnect command shape.
- The implementation adds no persisted state, no provider-specific runtime
  tables, and no new device-sync execution path in the foreground reply flow.
- Focused tests, typecheck, PR CI, and the ReviewGPT PR loop prove the change.

## Scope

- `packages/assistant-engine` prompt context plumbing and focused tests.
- `packages/assistant-runtime` hosted runtime device-sync status prompt and
  focused tests.
- Existing managed-automation prompt guidance for weekly health digest.

## Constraints

- Treat the supplied patch as behavioral intent, not overwrite authority.
- Preserve foreground priority: device-sync status fetching must be bounded to
  existing runtime snapshot context and must not run device-sync work.
- Keep provider-specific handling limited to display/reconnect mapping derived
  from existing configured targets.
- Do not add durable state or broaden external/provider authority.

## Verification Plan

- `pnpm test:diff <changed files...>` or owner-level package coverage if the
  diff-aware lane is not truthful.
- `pnpm typecheck`.
- Parent local final review of the full diff and affected call paths.
- Open a draft PR and run the PR-lane ReviewGPT loop to zero accepted findings.

## Notes

- Local completion audit subagents are default-skipped under the PR-lane patch
  implementation rule; ReviewGPT PR review is the audit gate after push.
- Verification completed in the isolated worktree:
  - `pnpm test:diff`
  - `pnpm typecheck`
Updated: 2026-06-29
Completed: 2026-06-29
