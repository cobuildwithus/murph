# PR 267 Conflict Resolution

## Goal

Resolve PR 267 against current `main` while preserving the on-demand computer
handoff behavior and the latest base-branch changes.

## Constraints

- Keep the resolution scoped to merge conflicts and any tests needed to prove
  the resolved behavior.
- Preserve fail-closed hosted computer-use authority, handoff token secrecy,
  fresh chat consent for final-confirmation resume, and view-only inspection
  semantics.
- Do not redesign the handoff UI beyond reconciling base and PR behavior.
- Preserve unrelated active ledger rows and worktree changes.

## Working Set

- `apps/web/app/computer/handoff/[token]/page.tsx`
- `apps/web/src/components/computer-use/computer-handoff-active-view.tsx`
- `apps/web/src/lib/computer-use/service.ts`
- `apps/web/src/lib/computer-use/store.ts`
- `apps/web/test/computer-handoff-active-view.test.tsx`
- `apps/web/test/computer-handoff-route-page.test.tsx`
- `apps/web/test/hosted-execution-computer-use.test.ts`
- `packages/assistant-engine/skills/computer-use/SKILL.md`
- `packages/assistant-engine/src/assistant-codex/dynamic-tools.ts`
- `packages/assistant-engine/src/assistant/system-prompt.ts`
- `packages/assistant-engine/test/assistant-codex-computer-tools.test.ts`
- `packages/hosted-execution/src/computer-use.ts`

## Verification Plan

- Inspect every conflict manually.
- Run focused hosted computer-use and handoff UI Vitest.
- Run `git diff --check`.
- Run scoped diff verification over the touched PR files when local time permits,
  or report any credible pre-existing blockers.
- Push the PR branch and use the PR review loop unless the user opts out.
Status: completed
Updated: 2026-06-24
Completed: 2026-06-24
