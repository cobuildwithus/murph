# PR 295 ReviewGPT Fixes

## Goal

Resolve the accepted Pro Extended ReviewGPT findings for PR 295 and rerun the external review loop until the PR has zero accepted findings.

Success criteria:

- `murph.computer_os_control` follows the same assistant-engine availability and executable-tool guard as other hosted computer tools.
- Retell phone-call result mapping never persists provider `call_summary` fallback text when the configured bounded custom analysis result is missing.
- Hosted action-approval parsing accepts deploy-skew requests where `returnContactKind` is absent and normalizes that field to `null`.
- Focused tests prove each accepted finding, required checks pass, the branch is pushed, and ReviewGPT Pro Extended returns no accepted findings on the pushed head.

## Constraints

- Keep fixes narrow and at the existing owner boundaries.
- Do not introduce new durable state, queues, compatibility layers, or provider abstractions.
- Preserve hosted phone-call privacy boundaries: no raw Retell transcripts, recordings, provider bodies, or transcript-derived summaries in persisted Murph results.
- Preserve deploy-skew compatibility without weakening new request serialization.
- Preserve unrelated active-plan and working-tree edits.

## Working Set

- `packages/assistant-engine/src/assistant-codex/dynamic-tools.ts`
- `packages/assistant-engine/test/*`
- `apps/web/src/lib/phone-calls/result.ts`
- `apps/web/test/*phone*`
- `packages/hosted-execution/src/action-approval.ts`
- `packages/hosted-execution/test/*`

## Verification Plan

- Focused tests for each accepted finding.
- `pnpm test:diff` over the changed files when the focused tests pass.
- `pnpm typecheck` unless blocked by a credibly unrelated baseline failure.
- Commit and push the reviewed branch head.
- Rerun ReviewGPT Pro Extended on the pushed PR head until zero accepted findings.
Status: completed
Updated: 2026-06-26
Completed: 2026-06-26
