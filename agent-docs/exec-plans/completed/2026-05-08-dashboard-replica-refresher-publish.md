# Dashboard Replica Refresher Publish

## Goal

Move detached browser-vault replica publish ownership from `HostedUserRunner` into the dashboard replica refresher so the refresher generates, writes, and publishes the derived replica behind the source-hash guard.

## Constraints

- Preserve foreground preemption and scheduling in `DashboardReplicaCoordinator` / `HostedUserRunner`.
- Keep source-hash guards on write and publish.
- Preserve retry behavior for publish CAS conflicts where the workspace source hash has not advanced.
- Do not touch unrelated active hosted working-delta diagnostics edits.

## Working Set

- `apps/cloudflare/src/dashboard-replica/refresher.ts`
- `apps/cloudflare/src/node-runner.ts`
- `apps/cloudflare/src/user-runner.ts`
- `apps/cloudflare/src/runner-container.ts`
- `apps/cloudflare/test/node-runner-browser-vault-refresh.test.ts`
- `apps/cloudflare/test/user-runner-alarm.test.ts`

## Progress

- Status: implementation and verification complete
- Done: Refresher now generates, writes, and publishes through `publishRef`; runner only coordinates scheduling/preemption; refresh abort signals reach the container fetch and refresher before publish; focused tests cover publish, conflict retry, no runner-side publish, and abort-before-publish.
- Next: close plan with scoped commit.
Status: completed
Updated: 2026-05-08
Completed: 2026-05-08
