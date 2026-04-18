## Goal

Hard-cut the remaining hosted execution producer surface onto the canonical
`HostedWake` + `HostedExecutionCursor` lifecycle so web-owned wakes are the
only hosted scheduling owner on this branch, Linq/Telegram webhook producers
stop storing legacy `HostedExecutionDispatchRequest` envelopes inside new wake
rows, and the durable docs no longer describe `execution_outbox` as canonical.

## Scope

- `apps/web/src/lib/hosted-execution/dispatch-lifecycle.ts`
- `apps/web/src/lib/hosted-wake/{dispatch,payload,control}.ts`
- `apps/web/src/lib/hosted-onboarding/{webhook-dispatch-payload,webhook-provider-linq,webhook-provider-telegram,webhook-receipt-store,webhook-receipt-types}.ts`
- `apps/cloudflare/src/user-runner.ts`
- `packages/hosted-execution/src/{builders,contracts,parsers}.ts`
- focused hosted-web / hosted-execution tests covering direct Linq/Telegram wake payload append and runner execution
- durable hosted-architecture docs: `ARCHITECTURE.md`, `apps/web/README.md`

## Constraints

- Preserve legacy dispatch payload decoding during the cutover, but stop
  producing new Linq/Telegram wake rows that store full
  `HostedExecutionDispatchRequest` envelopes.
- Keep the handoff helper fire-and-log only; do not reintroduce awaited
  recovery semantics.
- Preserve unrelated hosted web and Cloudflare work already present in the tree.
- Do not reintroduce any `execution_outbox` fallback language or producer
  branching.

## Verification

- `pnpm typecheck`
- Truthful scoped coverage or diff-aware verification for the touched hosted app/runtime slices
- Required completion audits per repo workflow before commit
Status: completed
Updated: 2026-04-18
Completed: 2026-04-18
