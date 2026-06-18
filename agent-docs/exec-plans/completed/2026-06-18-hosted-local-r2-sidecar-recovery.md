# Hosted Local R2 Sidecar Recovery

## Goal

Diagnose and fix the local hosted-runtime no-reply loop where the runner accepts work but fails during workspace snapshot restore after the hosted-local R2 sidecar exits.

## Success Criteria

- Hosted-local MinIO/R2 sidecar exits are recovered without resetting the database or adding a production scheduler/queue.
- A hosted-local E2E scenario proves that a wake after a checkpoint still completes after the sidecar is killed and restarted.
- Targeted unit tests, focused E2E proof, typecheck, and required completion audits pass or have explicit unrelated blockers.

## Scope

- `packages/hosted-local-harness/src/dev-hosted-local/minio.ts`
- `packages/hosted-local-harness/src/dev-hosted-local/stack.ts`
- Hosted-local harness tests for MinIO/stack behavior
- Focused hosted-local E2E registration and scenario under `apps/cloudflare/test/**`

## Non-Goals

- No changes to production R2 semantics.
- No new hosted scheduler, queue, or fallback owner.
- No changes to `apps/cloudflare/src/runner-container.ts` while the runner destroy-timeout lane is active.

## Verification Plan

- Focused hosted-local harness tests for MinIO restart and stack monitoring.
- Focused hosted-local E2E recovery proof.
- Scoped diff verification and root typecheck per repo policy.
Status: completed
Updated: 2026-06-18
Completed: 2026-06-18
