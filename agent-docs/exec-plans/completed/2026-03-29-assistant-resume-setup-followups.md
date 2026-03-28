# 2026-03-29 Assistant Resume And Setup Follow-Ups

## Goal

Close the last reviewed assistant correctness gaps by making stateful-provider resume fail closed on both route and workspace metadata, and by persisting `codexCommand` when setup saves assistant defaults.

## Scope

- `packages/cli/src/assistant/service.ts`
- `packages/cli/src/setup-services.ts`
- Targeted `packages/cli/test/{assistant-service.test.ts,setup-cli.test.ts}`
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`

## Invariants

- Stateful provider resume only happens when persisted or recovered bindings explicitly match the current route and workspace.
- Missing `resumeRouteId` or `resumeWorkspaceKey` means cold start, not implicit match.
- Setup must continue preserving unrelated saved provider defaults while allowing an updated Codex binary path to persist.
- Changes stay behavior-preserving outside the reviewed resume/setup persistence edges.

## Plan

1. Tighten `resolveAssistantRouteResumeBinding` so recovered and persisted bindings require explicit route and workspace matches.
2. Add assistant-service regressions for recovered-binding workspace mismatch and legacy missing resume metadata.
3. Thread `codexCommand` through setup defaults persistence and add a rerun-setup regression proving the saved path updates.
4. Run required verification, completion-workflow audits, and commit only the touched files.
Status: completed
Updated: 2026-03-29
Completed: 2026-03-29
