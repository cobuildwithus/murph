# PR 295 ReviewGPT round 12 cleanup

## Goal

Resolve the accepted ReviewGPT round 12 complexity-collapse recommendation.

Success criteria:

- Remove the unused generic hosted-tool request-key scope method and wiring.
- Keep the phone-call-specific request-key scope and authority filter intact.
- Remove unrelated test double boilerplate created only for the generic seam.
- Focused verification and typecheck pass before pushing and rerunning
  ReviewGPT.

## Constraints

- Do not weaken phone-call manual-input authority checks.
- Do not add replacement abstractions.
- Preserve existing non-phone hosted tool behavior.
- Preserve unrelated active-plan and working-tree edits.

## Approach

1. Delete `currentHostedToolRequestKeyScope` and its local-service wiring.
2. Keep `AssistantHostedToolRequestKeyScope` as the shared phone-call request
   key data type.
3. Remove stale test stubs and run focused assistant verification.

## State

Ready for scoped commit.

## Notes

- Round 12 had no Critical, High, or invariant violations.
- Cleanup finding: generic request-key scope was unused by production behavior
  and broadened the hosted tool context surface unnecessarily.
- Fixed by deleting `currentHostedToolRequestKeyScope`, deleting
  `getAcceptedInputIds`, and removing stale test stubs.
- Verification passed:
  `pnpm --dir packages/assistant-engine exec vitest run test/assistant-phone-calls.test.ts test/assistant-codex-runtime.test.ts test/assistant-codex-connected-apps.test.ts test/assistant-codex-computer-tools.test.ts test/assistant-protocol-index-planning.test.ts test/assistant-vault-file-send.test.ts`;
  `pnpm --filter @murphai/assistant-engine typecheck`;
  `git diff --check`.
Status: completed
Updated: 2026-06-25
Completed: 2026-06-25
