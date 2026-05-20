# Remove device-sync agent signals route

Status: completed
Created: 2026-05-20
Updated: 2026-05-19

## Goal

- Fully remove the unused hosted local-agent `GET /api/device-sync/agent/signals`
  API surface while preserving the underlying device-sync signal write/storage
  path used for internal wake and audit events.

## Success Criteria

- The route file is deleted and no tests/docs advertise the endpoint.
- Dead route-only list methods are removed from the control-plane and agent
  session service layers.
- Existing device-sync signal writes continue to typecheck and focused tests pass.
- Clawpatch no longer reports the stale raw-signals-payload finding as open.

## Scope

- In scope:
  - Hosted web route file, route tests, local-agent docs, and route-only service
    methods for listing signals.
  - Focused device-sync tests covering remaining agent routes and signal store
    write behavior.
- Out of scope:
  - Removing `DeviceSyncSignal` storage or signal write paths used by hosted
    wake/reconcile/revoke diagnostics.
  - Changing token export, refresh, local heartbeat, pair, or webhook behavior.

## Constraints

- Preserve unrelated dirty work in the checkout.
- Do not expose secrets, local paths, raw auth headers, or private data in tests
  or docs.

## Verification

- Passed:
  - Focused hosted web Vitest for affected route/store tests:
    `agent-route.test.ts`, `agent-session-routes.test.ts`, and
    `prisma-store-device-sync-signal.test.ts`.
  - Focused eslint over the changed route-adjacent source/test files; it
    reported only pre-existing unused-variable warnings in
    `agent-session-service.ts`.
  - Scoped diff check for changed files.
  - Stale-reference scan for the removed endpoint and route-only list methods.
  - Clawpatch revalidate for
    `fnd_sig-feat-route-443697c01d-807806_214695b479` returned `fixed`, and
    hosted-web status now reports 20 open findings.
- Blocked by unrelated dirty work:
  - `pnpm typecheck` and scoped `pnpm test:diff` both fail before reaching this
    diff on the existing raw-log guard findings in hosted onboarding workflow
    files.
  - Direct `apps/web` TypeScript check is blocked by unrelated dirty
    `packages/hosted-execution/src/workspace-snapshot-v2.ts` errors.
Completed: 2026-05-19
