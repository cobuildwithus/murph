# DeepSec Linq/device-sync bounds

Status: completed
Created: 2026-05-09
Updated: 2026-05-09

## Goal

- Investigate five DeepSec findings around Linq first-contact invite retries, Strava/WHOOP pagination bounds, and SQLite OAuth owner binding.
- Land only small durable fixes where the finding is confirmed by current code.

## Success criteria

- Confirmed findings have focused regression coverage.
- Fixes stay local to the owning route/provider/store seams without new broad infrastructure.
- Focused package/app checks pass; typecheck is attempted per repo policy.
- Any finding judged mitigated or false-positive is backed by direct code evidence.

## Scope

- In scope: `apps/web` hosted Linq first-contact planning/send behavior, `packages/device-syncd` Strava/WHOOP pagination, SQLite OAuth state store/schema, focused tests.
- Out of scope: unrelated DeepSec findings, broad webhook outbox rewrites, and unrelated active worktree changes.

## Constraints

- Preserve unrelated dirty worktree edits and active plan rows.
- Do not weaken retry/idempotency behavior just to silence a finding.
- Keep local device-sync OAuth state compatible with existing single-operator rows while enforcing owner binding when supplied.

## Risks and mitigations

1. Risk: Linq duplicate-invite mitigation could suppress a retry after a transient send failure.
   Mitigation: verify current invite/member locking and idempotency first; avoid pre-send "sent" marking unless a better durable outbox exists.
2. Risk: Pagination caps could reject legitimate large backfills.
   Mitigation: use conservative high caps and fail retryably with provider-specific error codes.
3. Risk: SQLite schema changes could strand existing runtime DBs.
   Mitigation: add an additive nullable `owner_id` column through the existing schema/migration path.

## Tasks

1. Trace each finding against current code and tests.
2. Patch confirmed device-sync store/provider issues.
3. Add focused regression coverage.
4. Run focused checks, typecheck, and required audits.
5. Close the plan with a scoped commit if the dirty worktree permits.

## Decisions

- Linq first-contact duplicate invite rows were not patched because current code already mitigates the reported row-duplication premise: member creation is uniqueness-backed, `issueHostedInviteTx` locks the member row, reuses an existing unexpired invite, and invite signup sends use invite-scoped Linq idempotency. A broader durable side-effect outbox could improve send-state observability, but pre-send notice marking would make retry reliability worse.
- Strava pagination is a confirmed resource-bound risk; add explicit page and record caps with retryable provider errors.
- WHOOP pagination is a confirmed loop/resource-bound risk; add page, record, and repeated-cursor guards with retryable provider errors.
- SQLite OAuth owner binding is a confirmed contract bug; persist nullable `owner_id`, enforce `expectedOwnerId`, preserve states on mismatch, and migrate v5 stores additively.

## Verification

- Passed: `pnpm --dir packages/device-syncd exec vitest run test/store.test.ts test/service.test.ts test/strava-provider.test.ts test/whoop-provider.test.ts --config vitest.config.ts --no-coverage`
- Passed after the WHOOP page-limit proof addition: `pnpm --dir packages/device-syncd exec vitest run test/whoop-provider.test.ts --config vitest.config.ts --no-coverage`
- Passed: `pnpm --dir packages/device-syncd typecheck`
- Passed: `pnpm --dir packages/device-syncd test:coverage`
- Passed: `pnpm typecheck`
- Security/privacy review: passed with no findings; noted Linq duplicate-message suppression still depends on Linq honoring the invite-scoped idempotency key.
- Coverage-write review: passed with no edits; reran `pnpm --dir packages/device-syncd test:coverage` after the WHOOP page-limit proof addition.
- Pending: final completion review and final scoped commit.
Completed: 2026-05-09
