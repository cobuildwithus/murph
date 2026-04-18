# Hosted hard-cut batch 2

Status: completed
Created: 2026-04-18
Updated: 2026-04-18

## Goal

- Finish the remaining greenfield hosted hard-cut work after batch 1 by:
  - replacing dispatch-era message wake ownership with one canonical hosted
    conversation wake contract
  - moving hosted email onto that same canonical message wake path
  - deleting Cloudflare-owned queue lifecycle truth so the runner becomes a
    thin lease/alarm/run actor with only the minimal local state it still needs

## Success criteria

- `HostedExecutionDispatchRequest` is no longer the canonical external wake
  append contract for message traffic.
- Linq, Telegram, and email all append the same canonical hosted conversation
  wake contract into `HostedWake`.
- assistant-runtime consumes that canonical conversation wake without relying on
  provider-specific top-level event kinds.
- Cloudflare no longer persists `pending_events`, `consumed_events`, or
  `poisoned_events`, and no longer treats local queue state as lifecycle truth.
- Verification proves the contract migration and thin-shim queue deletion across
  the touched surfaces.

## Scope

- In scope:
  - `packages/hosted-execution/**` canonical hosted wake contract changes
  - `apps/web/src/lib/hosted-wake/**` and internal append/status routes
  - webhook/email producers that still speak dispatch-era message kinds
  - `packages/assistant-runtime/src/hosted-runtime/**` message wake handling
  - `apps/cloudflare/src/user-runner/**`, runner state, scheduler, and
    user-runner integration needed for queue ownership deletion
- Out of scope:
  - unrelated `apps/cloudflare` hosted local e2e stabilization work
  - unrelated release-manifest or homepage work already dirty in the tree
  - speculative new hosted product behavior beyond the hard-cut architecture

## Constraints

- Preserve the web-owned `HostedWake` / `HostedExecutionCursor` substrate and
  compare-and-swap commit fence.
- Preserve unrelated dirty-tree edits and active coordination-ledger lanes.
- Keep subagent write ownership disjoint enough to avoid predictable conflicts.
- Keep Cloudflare local state limited to the minimum needed for:
  - active run lease / epoch
  - in-flight run metadata
  - next wake scheduling
  - cached bundle refs and commit recovery

## Risks and mitigations

1. Risk: canonicalizing message wakes can spread through runtime typing,
   context, callbacks, tests, and append routes.
   Mitigation: centralize the contract design locally, then give one worker
   ownership of the shared contract plus its producer/runtime consumers.

2. Risk: deleting `pending_events` / `consumed_events` / `poisoned_events`
   could regress runner recovery or bundle cache ownership.
   Mitigation: keep the Cloudflare worker focused on replacing the queue store
   with a thinner runner state store instead of mixing in the contract rename.

3. Risk: batch 2 overlaps the existing Cloudflare e2e stabilization lane.
   Mitigation: keep this task scoped to runner ownership files and targeted
   runner tests; do not touch the in-progress hosted local e2e harness unless
   required by compile failures.

## Tasks

1. Define the canonical hosted conversation wake contract locally and register
   the batch in the coordination ledger.
2. Spawn a shared-contract/message-lane worker to migrate:
   - hosted-execution contracts/builders/parsers/tests
   - web append helpers/routes for canonical message wakes
   - email ingress producer
   - assistant-runtime message wake consumers
3. Spawn a Cloudflare thin-runner worker to:
   - replace queue lifecycle truth with minimal runner state ownership
   - remove `pending_events` / `consumed_events` / `poisoned_events`
   - preserve lease, wake scheduling, bundle ref cache, and commit recovery
4. Integrate both slices locally and close remaining cross-surface seams.
5. Run verification, required audits, and commit the scoped batch.

## Decisions

- Use one canonical message wake kind for all conversation traffic instead of
  preserving provider-specific top-level event kinds.
- Let message-provider detail live under the canonical message wake payload,
  while system wakes remain explicit top-level kinds.
- Treat Cloudflare as a thin execution actor only; lifecycle truth lives in web.

## Verification

- High-signal commands after integration:
  - `pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/test/hosted-wake-dispatch.test.ts apps/web/test/hosted-onboarding-*.test.ts --no-coverage`
  - `pnpm exec vitest run packages/hosted-execution/test/*.test.ts --no-coverage`
  - `pnpm exec vitest run --config vitest.node.workspace.ts apps/cloudflare/test/user-runner*.test.ts apps/cloudflare/test/runner-queue-store*.test.ts --no-coverage`
  - `pnpm exec vitest run packages/assistant-runtime/test/hosted-runtime-*.test.ts --no-coverage`
  - `pnpm typecheck` in `apps/web`, `apps/cloudflare`, `packages/assistant-runtime`, and `packages/hosted-execution` as needed

## Outcome

- Landed the wake-first contract end to end for active hosted message traffic:
  web append/status routes, webhook/email producers, hosted-execution
  contracts/parsers/builders, and assistant-runtime message consumers now
  converge on canonical hosted wakes.
- Removed Cloudflare-owned queue lifecycle truth from the thin runner path:
  runner schema/state no longer persist `pending_events`, `consumed_events`,
  `backpressured_events`, or `poisoned_events`, and runtime-facing status now
  treats hosted web wake state as canonical.
- Deleted the remaining dispatch-only production helpers/tests that no longer
  own hosted wake lifecycle state.
- Added the required audit passes:
  - `coverage-write` on `gpt-5.4-mini` landed focused proof in
    `packages/hosted-execution/test/**` and
    `packages/assistant-runtime/test/**`
  - `task-finish-review` found one runner-request validation gap and one stale
    wake-route test; both were fixed locally before closeout

## Verification Results

- Passed:
  - `pnpm --dir packages/hosted-execution typecheck`
  - `pnpm --dir packages/hosted-execution build`
  - `pnpm --dir packages/hosted-execution test:coverage`
  - `pnpm --dir packages/assistant-runtime test:coverage`
  - `pnpm --dir apps/web exec vitest run test/hosted-wake-routes.test.ts --config vitest.workspace.ts --no-coverage`
  - `NODE_OPTIONS='' pnpm --dir apps/cloudflare verify`
- Earlier targeted proofs that also passed during integration:
  - focused hosted web wake/onboarding/share tests
  - focused hosted runtime event/execution tests
  - focused Cloudflare hosted wake/runtime tests
- Known residual manual proof gap:
  - no live human run was performed for real provider round-trips through each
    ingress (`email`, `Linq`, `Telegram`) after this batch; automated proof is
    present, but a live smoke would still be valuable
Completed: 2026-04-18
