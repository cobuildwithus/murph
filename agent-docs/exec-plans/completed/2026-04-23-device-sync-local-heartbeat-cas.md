# Prevent hosted local-heartbeat writes from clobbering concurrent device-connection metadata and settings updates

Status: completed
Created: 2026-04-23
Updated: 2026-04-23

## Goal

- Prevent hosted local-heartbeat writes from reverting concurrent device-connection metadata, settings, or status updates while preserving the existing heartbeat validation and response shape.

## Success criteria

- Local heartbeat persistence updates only the heartbeat-owned durable fields instead of rewriting unrelated connection columns from a stale read.
- Concurrent writes to hosted connection metadata such as `displayName`, `metadata`, `scopes`, `status`, or `nextReconcileAt` are preserved across a later heartbeat write.
- Focused `apps/web` tests cover the non-clobbering write path and the existing heartbeat semantics still pass.
- Required scoped verification, completion audits, and a scoped commit all complete or any unrelated blocker is documented.

## Scope

- In scope:
  - `apps/web/src/lib/device-sync/prisma-store/{local-heartbeats.ts,connections.ts}`
  - `apps/web/src/lib/device-sync/prisma-store.ts`
  - directly coupled `apps/web/test/**` coverage for the heartbeat persistence seam
- Out of scope:
  - schema changes
  - unrelated hosted device-sync runtime-authority or token-refresh behavior changes
  - hosted onboarding, billing, or hosted-run work already active in the dirty tree

## Constraints

- Technical constraints:
  - Preserve existing local-heartbeat validation semantics from `local-heartbeat.ts`.
  - Work safely on a dirty tree and avoid unrelated `apps/web` files.
  - Keep the durable write path aligned with the existing Prisma/device-sync store abstractions.
- Product/process constraints:
  - This is `apps/web` reliability/concurrency work, so capture direct proof in addition to scripted checks.
  - Use the plan-bearing workflow and required completion audits before handoff.

## Risks and mitigations

1. Risk: A narrow fix could still race with concurrent token/state updates if it bypasses the existing connection-store seams incorrectly.
   Mitigation: Reuse the store transaction/lock contracts where appropriate and keep the new write surface limited to heartbeat-owned fields.
2. Risk: Focused tests could miss the regression if they only assert the returned in-memory account shape.
   Mitigation: Add a regression test that inspects the durable write payload and verifies unrelated columns are not rewritten.

## Tasks

1. Register the active plan/ledger scope and inspect existing connection write patterns.
2. Implement a heartbeat-owned durable update path in the Prisma connection store and switch local heartbeats to use it.
3. Add focused regression coverage for stale-read heartbeat writes versus concurrent metadata/settings updates.
4. Run scoped `apps/web` verification plus direct proof, then the required audit passes and commit flow.

## Decisions

- Keep the heartbeat path on its existing read-then-validate flow, but change the durable persistence step to write only heartbeat-owned columns instead of replaying the whole public connection snapshot.

## Verification

- Commands to run:
  - `pnpm typecheck`
  - `bash scripts/workspace-verify.sh test:diff apps/web/src/lib/device-sync/prisma-store/local-heartbeats.ts apps/web/src/lib/device-sync/prisma-store/connections.ts apps/web/src/lib/device-sync/prisma-store.ts apps/web/test/prisma-store-local-heartbeat.test.ts`
  - `pnpm --dir apps/web lint`
- Expected outcomes:
  - Scoped `apps/web` device-sync tests pass with the new regression coverage.
  - Typecheck and hosted-web lint remain green for the touched slice.
Completed: 2026-04-23
