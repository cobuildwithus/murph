# Device-Sync Runtime Contract Split

## Goal

Split the hosted/local device-sync mirror contract so hosted snapshots and apply updates treat connection state plus token escrow as hosted-authoritative, while local observation/heartbeat/reconcile state stays local-first and is synchronized explicitly instead of being merged through `hostedObservedUpdatedAt`, `hostedObservedTokenVersion`, and `hasLocalPendingHostedChanges`.

## Why

- The current runtime seam mixes hosted-owned connection/token state with local observation timestamps and retry metadata in one snapshot/update contract.
- The existing mirror relies on implicit merge arbitration markers, which makes retry and ownership rules harder to reason about.
- The hosted/local split already exists conceptually in the control-plane design; this pass should make that ownership explicit in the runtime contract and hydration/apply logic.

## Scope

- `packages/assistant-runtime/src/hosted-device-sync-runtime.ts`
- `packages/device-syncd/src/{store.ts,types.ts}`
- `packages/hosted-execution/src/{contracts.ts,parsers.ts}`
- `apps/web/src/lib/device-sync/{internal-runtime.ts,internal-runtime-request.ts}`
- Focused regression coverage in hosted-runtime, device-syncd, and hosted-web tests

## Constraints

- Keep hosted connection status, display/scopes/metadata, schedule, and token escrow authoritative from the hosted snapshot/apply seam.
- Keep local observation fields such as webhook/sync timestamps and local reconcile/error heartbeat data out of the hosted-authoritative arbitration path.
- Preserve hosted disconnect authority and current wake-hint behavior.
- Preserve unrelated dirty-tree edits, especially the existing non-device-sync contract edit in `packages/hosted-execution/src/contracts.ts`.
- Avoid schema churn unless it is strictly required; prefer simplifying the runtime contract first.

## Verification

- Focused runtime/store/app regression tests covering hosted hydration, hosted apply, and local observation propagation
- Package-level typechecks for touched packages if needed
- Repo-required verification commands per `agent-docs/operations/verification-and-runtime.md`, with explicit handoff if unrelated pre-existing failures remain

## Commit Plan

- Use `scripts/finish-task` while this plan remains active so the completed plan artifact ships with the scoped commit.
Status: completed
Updated: 2026-04-02
Completed: 2026-04-02
