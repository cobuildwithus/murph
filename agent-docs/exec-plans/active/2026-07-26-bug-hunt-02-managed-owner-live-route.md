# Round 2 Managed Automation Live-Route Correction

## Status

Active.

## Why

A static built-in automation with immutable `member` ownership can be admitted
from a saved direct or unspecified Linq route, then resolve a live non-direct
group route for tools and delivery. That lets stale routing data cross the
managed owner boundary before provider work.

## Outcome

Every delivery-bearing static managed automation must authorize and reuse the
same live route before lifecycle hooks, model work, tools, outbox creation, or
delivery:

- `member` seeds accept only a live direct route;
- `authenticated-group` seeds accept only a live authenticated group route;
- unmanaged and retired automation behavior remains unchanged.

## Invariants

- The immutable built-in automation id and owner scope remain the only managed
  identity authority.
- Saved routes remain routing hints, never live audience authority.
- The route checked during managed-owner admission is the route used for the
  scheduled turn.
- A live owner mismatch fails before lifecycle hooks, model work, tools, or
  outbox creation.
- Silent preemptible personal-memory maintenance keeps its route-independent
  no-delivery behavior.
- No new persisted state, retry owner, service, or compatibility path is added.

## Scope

- `packages/assistant-engine/src/assistant/cron/execution.ts`
- `packages/assistant-engine/test/assistant-cron-runtime.test.ts`
- This plan and its coordination-ledger row

## Work

1. Add a focused failing regression for a member-owned built-in whose saved
   Linq route is direct/unspecified while live Web authority resolves a group.
2. Resolve live delivery authority for every authorized static managed seed,
   validate immutable owner scope against that live route, and reuse the
   resulting authorized delivery in execution.
3. Run the focused test, package verification, canonical diff verification,
   preliminary coverage-specialist ReviewGPT pass, parent final review, final
   ReviewGPT gate, and CI.
4. Close this plan with `scripts/finish-task`, keep the PR draft and unmerged,
   and preserve the task worktree.

## Verification

- Focused assistant cron regression, failing before and passing after
- Assistant Engine package test/typecheck coverage selected by the canonical
  dispatcher
- `pnpm test:diff packages/assistant-engine/src/assistant/cron/execution.ts packages/assistant-engine/test/assistant-cron-runtime.test.ts`
- `pnpm verify:acceptance`
- Preliminary `completion-specialists` coverage lens
- Parent final diff/call-path review
- Final ReviewGPT exact-head gate and required PR CI
