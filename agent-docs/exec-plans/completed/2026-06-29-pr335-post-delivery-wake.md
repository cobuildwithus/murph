# PR 335 post-delivery wake cleanup

Status: completed
Created: 2026-06-29
Updated: 2026-06-29

## Goal

Fix the remaining PR 335 `Linq scheduled reminder E2E` CI failure where a
successful post-checkpoint delivery can leave the consumed assistant wake as
the workspace `nextWakeAt`.

## Success criteria

- The consumed workspace assistant wake is not re-selected after successful
  post-checkpoint delivery.
- Legitimate future assistant, system-mailbox, provider-cleanup, and
  device-sync wakes are preserved.
- Focused assistant-runtime regression tests and typecheck pass.
- PR checks are green after push.

## Scope

- In scope:
  - `packages/assistant-runtime/src/hosted-runtime/workspace-assistant-phase.ts`
  - `packages/assistant-runtime/test/hosted-runtime-workspace-assistant-phase.test.ts`
- Out of scope:
  - Warm Codex app server behavior.
  - New scheduler, service, or persistence abstractions.

## Constraints

- Keep the fix local to wake candidate normalization.
- Do not weaken runtime/auth/checkpoint invariants.
- Do not expose secrets, raw payloads, home paths, or local user identifiers.

## Risks and mitigations

1. Risk: Dropping a legitimate future retry wake.
   Mitigation: Drop only assistant-reason candidates that exactly match the
   workspace wake and are already consumed by the current phase.

## Tasks

1. Patch post-delivery candidate filtering.
2. Add a focused regression test for a consumed assistant wake echo after
   successful delivery.
3. Run scoped verification.
4. Commit, push, and recheck CI.

## Decisions

- Use the existing wake candidate primitive; do not add a new scheduler layer.

## Verification

- `pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts --isolate=true --no-coverage test/hosted-runtime-workspace-assistant-phase.test.ts -t "consumed assistant wake|post-delivery"`
- `pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts --isolate=true --no-coverage test/hosted-runtime-workspace-assistant-phase.test.ts`
- `pnpm --dir packages/assistant-runtime typecheck`
- `bash scripts/workspace-verify.sh test:diff packages/assistant-runtime/src/hosted-runtime/workspace-assistant-phase.ts packages/assistant-runtime/test/hosted-runtime-workspace-assistant-phase.test.ts`
Completed: 2026-06-29
