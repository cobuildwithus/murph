# PR 465 Durable Usage-Limit Notice

## Goal

Land PR 465 with one durable owner for each hosted AI usage-limit notice and no
duplicate send across Linq, Telegram, retries, or legacy rollout keys.

## Constraints

- Keep the fix scoped to hosted AI usage-limit notice and Linq webhook side-effect behavior.
- Preserve retryability for real failed sends without allowing duplicate once-per-period notices after ambiguous provider outcomes.
- Preserve trial-conversion/no-claim inline replies as event-scoped.
- Do not weaken hosted ingress, billing, or usage gating invariants.
- Default to deletion: one claim operation, one persisted owner row, no new queue,
  manager, table, or lifecycle layer.
- Land and drain both rollback prerequisites before PR 465 web: PR 495 keeps
  active binaries from clearing the rollout fence, and PR 501 keeps ambiguous
  legacy Telegram sends claimed.
- Keep Vercel OIDC plus bound-user validation as the sole web-to-Worker auth
  boundary; do not add a co-located signing secret or inert provider fields.

## Working Set

- `apps/web/src/lib/hosted-execution/usage-allowance.ts`
- `apps/web/src/lib/hosted-execution/usage-limit-notice.ts`
- `apps/web/src/lib/hosted-onboarding/linq-delivery-store.ts`
- `apps/web/src/lib/hosted-onboarding/webhook-transport.ts`
- `apps/web/src/lib/hosted-orchestration/runtime-reconciliation-facts.ts`
- `packages/cloudflare-hosted-control/src/client.ts`
- `apps/cloudflare/src/worker/route-handlers/telegram-send.ts`
- `agent-docs/SECURITY.md`
- `ARCHITECTURE.md`
- `docs/contracts/00-invariants.md`
- `apps/web/test/hosted-execution-usage-allowance.test.ts`
- `apps/web/test/hosted-onboarding-linq-transport.test.ts`
- `apps/web/test/hosted-onboarding-linq-observability-store.test.ts`
- `apps/web/test/hosted-orchestration-reconciliation-facts.test.ts`
- `packages/cloudflare-hosted-control/test/client.test.ts`

## Verification Plan

- Focused Vitest for claim ownership, legacy-key behavior, Linq transport, and
  hosted-control failure classification.
- Scoped `pnpm test:diff` over the changed hosted usage and Linq webhook files.
- Required completion audits for hosted external delivery/retry behavior.
- Deploy and drain PR 495 and PR 501 before final PR checks.
- Rerun ReviewGPT on the pushed PR head and continue until zero accepted findings.
