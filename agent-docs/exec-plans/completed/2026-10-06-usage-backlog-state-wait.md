# Wait for authoritative usage blocking in backlog E2E

Status: completed
Created: 2026-10-06
Updated: 2026-10-06

## Goal and invariant

Make usage-limit backlog proof independent of native cleanup timing. While the
allowance is denied, all accepted conversation inputs stay unconsumed and no
assistant request runs. Credit release must produce exactly one model request
and attributable group reply, consume every input, and finish the runtime.

## Evidence and decision

The group test incorrectly equated usage denial with `inFlight: false`.
Runtime status derives that flag from any non-idle Postgres owner, including an
unlaunched starting fence. Native readiness can return `cleanup_unsettled`
while the preceding invocation finishes; the adapter deliberately preserves
that fence and returns `retry_later`. Blocked Temporal reconciliation need not
retire the fence before renewed runnable work arrives. Thus a longer idle wait
is not the correct proof of usage denial. The production behavior is unchanged.

Reuse the existing Temporal status query to wait for `blocked` with
`ai_usage_denied`, alongside conversation lag. Preserve the no-provider-call,
per-item unconsumed, single resumed request/reply, attribution, and final
completion checks. Apply the same correction to the composed handoff pause in
the same scenario. No new state owner, dependency, or runtime abstraction.

## Scope and constraints

Only this scenario and its execution evidence change. Other investigators'
scenarios, existing checkouts, production, pushes, and PRs are out of scope.
Local E2E runs use the shared lock and an isolated private Temporal worktree.
No changelog: internal test synchronization only. No deployment or skew change.

## Tasks

1. Trace failing/passing state transitions and the native busy recovery contract.
2. Replace both incidental idle waits with the authoritative blocked-state wait.
3. Run focused verification, attempt three composed local runs, review and commit.

## Verification

- Cloudflare typecheck passed after generating the fresh checkout's Prisma
  client. The initial check correctly failed on missing generated exports.
- Focused `runtime-processing-postgres.test.ts`: 62 tests passed, including
  preservation of a busy readiness claim without a launch or target retirement.
- Runner bundle preparation and parity checks passed.
- Composed `usage-limit-ambiguous-send`: three local runs passed all three tests
  (133.62 s, 110.43 s, 109.76 s). The last two repeats use the release lane's
  `allocate` standby setting. Each run acquired and released the shared E2E lock.
- `pnpm complexity:diff`, `pnpm docs:drift`, and `git diff --check` passed.
  The complexity guard excludes this test-only source change.
- Parent review: authoritative denial replaces an unrelated idle condition;
  provider counts, per-input consumption, reply attribution and complete
  post-credit drain remain required. No production source changes.
- No local pre-fix reproduction or induced 2-vCPU pressure. Local Docker exposes
  16 CPUs; supplied CI logs provide the failure evidence. No CI run or push.
- Privacy review passed. No new repository tooling friction was encountered;
  Prisma generation is the documented fresh-checkout prerequisite.
Completed: 2026-10-06
