Goal (incl. success criteria):
- Add an ops-controlled repair that wakes a hosted workspace and seeds Murph-managed automations using the member's current hosted delivery route.
- Keep web as the owner of hosted route lookup and mailbox append, Temporal pointer-only, and assistant-runtime as the owner of executable automation state.
- Success means an operator can enqueue a route-aware repair from `/ops/runtime-maintenance`, the runtime seeds or idempotently updates managed automations, and tests prove the mailbox contract plus runtime handler.

Constraints/Assumptions:
- Do not repair by directly mutating hosted workspace snapshots, Temporal state, or automation files from web.
- Do not add a new scheduler, queue, or fallback owner.
- Keep mailbox payloads bounded and metadata logs redacted.
- Preserve unrelated active ledger rows and avoid the hosted ingress repair lane's webhook files.

Key decisions:
- Represent the repair as a dedicated hosted mailbox system wake carrying the existing assistant notification route shape.
- Resolve the route in web from existing hosted member routing state, then signal Temporal with only the mailbox pointer.
- Seed managed automations in assistant-runtime with the route as the default delivery target.

State:
- Complete.

Done:
- Production evidence identified route-less maintenance as the failing boundary for stuck workspaces.
- Existing ops page, hosted execution wake contracts, and managed automation seeding paths were inspected.
- Added the hosted execution `assistant.managed-automation.seed-requested` mailbox wake contract.
- Added `/ops/runtime-maintenance` UI/API support for route-aware managed automation repair.
- Added assistant-runtime system wake handling that seeds managed automations with the web-resolved hosted route.
- Added focused hosted-execution, assistant-runtime, and hosted-web tests.

Now:
- Ready for commit.

Next:
- Deploy consumers before web emits the new mailbox kind.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- apps/web/app/(dashboard)/ops/runtime-maintenance/*
- apps/web/app/api/ops/runtime-maintenance/route.ts
- apps/web/src/lib/hosted-ops/runtime-maintenance.ts
- apps/web/test/hosted-runtime-maintenance-ops.test.ts
- packages/hosted-execution/src/{contracts,builders,parsers}.ts
- packages/hosted-execution/test/*
- packages/assistant-runtime/src/hosted-runtime/events*
- packages/assistant-runtime/test/hosted-runtime-events.test.ts
- `pnpm --dir packages/hosted-execution typecheck`
- `pnpm --dir packages/assistant-runtime typecheck`
- `pnpm --dir apps/web typecheck:prepared`
Status: completed
Updated: 2026-06-24
Completed: 2026-06-24
