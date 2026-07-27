# Remove Sunday superlatives

Status: active
Created: 2026-07-26
Updated: 2026-07-26

## Goal

- Remove the built-in Sunday superlatives automation and every feature-specific runtime/control-plane surface while preserving generic group managed automations as a supported capability.

## Success criteria

- New authenticated group runtimes can still reconcile and execute explicitly group-scoped managed seeds without installing member-scoped seeds.
- The Sunday superlatives seed is no longer installed, and any existing canonical record for its immutable id is archived before it can execute.
- The Sunday-only activity threshold, recap evidence projection, Web callback, Cloudflare port, shared contract, prompt guidance, and tests are deleted.
- Generic group owner reconciliation and fire-time route authorization remain covered.
- Canonical verification, preliminary specialist review, parent review, final ReviewGPT, and CI pass.

## Scope

- In scope: managed-automation seed ownership/reconciliation/execution, Sunday-only activity/evidence wiring across assistant engine/runtime, hosted execution, Web, Cloudflare, tests, and current durable docs.
- Out of scope: group newsletter behavior, group room-model maintenance, user-authored automations, personal managed seeds, and any replacement social automation.

## Constraints

- Prefer deletion; do not retain a disabled seed, feature flag, dormant callback, or speculative generic activity-policy framework.
- Preserve the vault automation record as the sole schedule/status/route owner and retain fire-time exact-seed plus live route checks for remaining built-ins.
- Preserve unrelated working-tree and coordination-ledger work.
- Do not edit immutable completed execution plans.

## Risks and mitigations

1. Risk: removing only the seed leaves an already-persisted Sunday record runnable.
   Mitigation: prove reconciliation archives removed built-in ids and add the smallest explicit retirement behavior only if the current owner does not.
2. Risk: broad reversal removes generic personal/group isolation added with the Sunday feature.
   Mitigation: separate feature-specific surfaces from owner-scope and route-authority primitives before editing; retain focused generic coverage.
3. Risk: independently deployed Web, Worker, and warm runner bundles disagree during removal.
   Mitigation: make removed policy calls fail closed during skew, document the safe deployment order, and verify the final bundle/source closure.

## Tasks

1. Trace static seed reconciliation and claimed execution from canonical record through delivery; classify every prior PR hunk as generic capability or Sunday-only policy.
2. Delete the Sunday seed and feature-only activity/evidence/control-plane surfaces while retaining generic group owner isolation.
3. Update focused tests and live owner docs to describe capability-only support with no built-in Sunday social automation.
4. Run focused and canonical verification plus a direct persisted-record retirement scenario.
5. Complete product, preliminary specialist, parent, final ReviewGPT, CI, merge, and worktree-retirement gates.

## Decisions

- “Group managed automations are possible” means seed authors may explicitly declare `authenticated-group`; it does not mean Murph ships a social group automation now.
- Existing silent group room-model maintenance remains in scope as an already-established internal maintenance seed, not the removed member-facing Sunday feature.
- The removed Sunday id remains only in a permanent retirement set. Deleting the
  seed without that tombstone would let an old persisted record fall through as
  unmanaged; reconciliation archival plus a pre-lifecycle execution deny is the
  smallest fail-closed correction.

## Verification

- Focused assistant-engine and hosted-execution Vitest: passed 236 tests.
- Full affected assistant-engine package lane: passed 177 files and 2,744 tests.
- Full affected assistant-runtime package lane: passed 76 files and 1,896 tests.
- Affected package and reverse-dependent TypeScript checks: passed.
- Cloudflare typecheck plus focused runner/platform tests: passed 244 tests.
- Web typecheck, including generated route contracts and Prisma client: passed.
- Scenario-manifest integrity: passed for 204 scenarios.
- Direct persisted-state proof: a real temporary-vault legacy record is archived
  during normal reconciliation; a separately claimed legacy occurrence skips
  before lifecycle or model work.
- Local `product-experience-review`: `NO FINDINGS`; no material evidence gaps.
- `pnpm test:diff ...` reached and passed the changed owners, then failed in
  unrelated CLI subprocess tests under host-wide 60/90-second timeout
  starvation. The already-failed remaining CLI batch was stopped after exact
  process-tree ownership was proven.
- `pnpm verify:acceptance` was attempted but stopped after more than ten
  continuous minutes waiting only for the exclusive shared-host slot, as
  required by the verification workflow. No remote executor is configured in
  this checkout.
