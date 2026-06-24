# Land connected-apps tool-context patch

Status: completed

## Goal

Land the supplied patch on an isolated branch/worktree, preserving its behavior
while resolving conflicts against the current origin/main code.

Success criteria:

- Patch intent is applied without broad rewrites or speculative abstractions.
- Connected-app dynamic tool availability flows through existing assistant and
  hosted runtime seams.
- Wearable provider catalog ownership changes preserve current importer/query
  behavior.
- Core canonical write-lock changes keep existing write authority invariants.
- Required verification and completion audits pass, or any unrelated blocker is
  reported with concrete evidence.

## Constraints

- Treat the supplied patch as behavioral intent, not overwrite authority.
- Preserve existing package ownership and public entrypoint boundaries.
- Do not expose secrets, local user identifiers, local absolute paths, or raw
  provider data in committed files or handoff text.
- Keep the result simple and composable; delete or collapse any conflict
  resolution complexity that is not needed for the actual behavior.
- Existing active ledger rows touch some assistant-engine and wearable-provider
  files; avoid widening beyond this patch lane.

## Working Set

- `packages/assistant-engine/**`
- `packages/assistant-runtime/**`
- `packages/core/**`
- `packages/query/**`
- `packages/importers/**`
- `packages/health-metrics/**`
- `packages/cli/test/**`

## Verification Plan

- `pnpm typecheck`
- `pnpm test:diff <touched paths>` if it truthfully covers the final diff,
  otherwise package-local coverage commands for touched owners plus required
  smoke checks from the verification matrix.
- Required completion audits: security/privacy, coverage-write, and deep-review
  unless the final diff narrows enough to change the routed class.

Updated: 2026-06-24
Completed: 2026-06-24
