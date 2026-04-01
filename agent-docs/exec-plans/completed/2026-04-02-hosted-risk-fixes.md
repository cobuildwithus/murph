# 2026-04-02 Hosted Risk Fixes

## Goal

- Land the supplied hosted runner risk-fix patch so gateway permission decisions survive later runtime snapshots, warm runner containers stop relying on stale forwarded env, and durable commit/finalize transitions for the same event apply serially with the gateway projection update.

## Scope

- `agent-docs/exec-plans/active/{2026-04-02-hosted-risk-fixes.md,COORDINATION_LEDGER.md}`
- `apps/cloudflare/src/{gateway-store.ts,hosted-env-policy.ts,node-runner.ts,runner-container.ts,runner-env.ts,user-runner.ts}`
- focused `apps/cloudflare/test/{gateway-store.test.ts,node-runner.test.ts,runner-container.test.ts,runner-env.test.ts,user-runner.test.ts}`

## Findings

- `HostedGatewayProjectionStore` currently rewrites the stored snapshot directly on operator response, so a later runtime snapshot can reopen or overwrite an already resolved permission.
- Native container launches still bake forwarded worker env into the warm process state, while the node runner can also read ambient process env when assembling runtime config.
- Commit and finalize already have per-event dedupe, but they do not share one serialization boundary with the gateway projection application for the same hosted event.

## Constraints

- Preserve unrelated dirty-tree edits already present in the repo.
- Keep the external hosted execution contract stable; this is an internal hardening pass.
- Gather direct proof for the DO overlay behavior and the per-job env forwarding path.

## Plan

1. Add the gateway permission override overlay and locked state reads/writes so operator responses remain authoritative across later runtime snapshots.
2. Move hosted runner forwarded env assembly to per-job runtime config and strip runner container start env down to the control token plus port.
3. Collapse commit/finalize durable writes plus gateway projection application under one per-event transition helper.
4. Extend focused tests for gateway idempotency, per-job forwarded env precedence, and native container invoke payload changes.
5. Run focused verification, then close and commit the scoped landing with the repo helper.

## Verification Target

- Focused tests under `apps/cloudflare/test/{gateway-store,node-runner,runner-container,runner-env,user-runner}.test.ts`
- Package-local typecheck for `apps/cloudflare` when the current tree allows it
- If repo-level `pnpm` commands remain blocked by unrelated lockfile drift, record the blocker and use direct binaries for focused proof

## Status

- Active
- Updated: 2026-04-02
Status: completed
Updated: 2026-04-02
Completed: 2026-04-02
