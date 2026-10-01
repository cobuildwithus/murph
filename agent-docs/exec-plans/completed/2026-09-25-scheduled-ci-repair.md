# Remove scheduled assistant real-model CI

Status: completed
Created: 2026-09-25
Updated: 2026-09-25

## Outcome

Remove the daily three-journey Assistant Real Model CI lane at the user's
request. Preserve all 380 locally selectable live Codex journeys and the
subscription/provider-auth local runner. Other scheduled CI repairs remain
outside this PR; Linq is explicitly excluded from that broader work.

## Implementation

- Disabled the existing GitHub workflow and verified `disabled_manually`.
- Deleted its workflow file, dedicated runner, and gate-specific tests.
- Removed obsolete credential-provisioning and scheduled-acceptance docs.
- Provisioned no credentials and made no runtime or local journey changes.

## Verification and review

- Local live-runner and selector suites: 11 tests passed.
- Tools TypeScript check passed.
- Agent docs drift and diff whitespace checks passed.
- Parent review confirmed only CI-specific executable code was deleted and
  the local runner/test definitions are unchanged.
- Complexity metrics are not applicable: no authored JavaScript/TypeScript
  remains in this deletion-only change.
- No member-facing changelog is needed for internal CI cleanup.
- PR CI and explicitly requested ReviewGPT are the remaining delivery gates;
  their exact-head results belong to the PR rather than this historical plan.
Completed: 2026-09-25
