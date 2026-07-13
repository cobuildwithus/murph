# PR 554 final audit corrections

Status: completed
Created: 2026-07-12
Updated: 2026-07-13

## Goal

Close the validated final-review gaps in the hosted device disconnect fence
without adding another state owner or activating lease claims before every old
web writer has drained.

## Success criteria

- Raw agent token export fails closed while either disconnect-lease column is
  non-null, including expired unresolved evidence and every refresh fast path.
- OAuth setup-failure cleanup cannot mutate or revoke a connection owned by a
  disconnect lease.
- Local heartbeats cannot mutate leased or terminal connections, so persisted
  manual-removal warnings survive late agent traffic.
- The first production release deploys lease-aware writer guards while keeping
  production disconnects on the compatible lease-less path; lease activation
  remains a second source release after the prior Vercel function window drains.
  If that first release later serves as the rollback floor, it still adopts or
  fails closed on pre-existing lease evidence without replaying provider revoke.
- Focused tests, typecheck, serial diff verification, completion audits,
  corrected-head ReviewGPT, and exact-head CI pass.

## Scope

- Hosted device disconnect, agent token export/refresh, OAuth cleanup, local
  heartbeat persistence, focused tests, and directly matching rollout docs.
- No new table, queue, scheduler, provider API, or durable lifecycle state.

## Decisions

- Reuse the existing connection advisory lock and non-null disconnect columns
  as unresolved effect evidence.
- Keep production lease claiming source-disabled in this first release while
  retaining the existing user-facing disconnect behavior and bounded revoke.
- Make the follow-up activation a separate source release after the documented
  Vercel drain and alias proof; do not add an environment-driven lifecycle.
- Keep the phase-one schema migration expand-only: add the nullable lease
  columns without a validating pair constraint. Writers mutate the pair
  atomically, and all readers treat either non-null column, including partial
  or malformed evidence, as unresolved and fail closed.

## Tasks

1. Fence every token export path on disconnect evidence.
2. Fence OAuth setup cleanup and local heartbeats under the existing lock.
3. Preserve compatible production disconnect behavior until the second source
   release and document the rollout/rollback floor.
4. Add focused regressions and run serial verification.
5. Finish the scoped commit, push, run one corrected-head ReviewGPT audit, and
   prove exact-head CI and review-thread state.

## Verification

- Focused web device-sync suites and web typecheck.
- Full serial `pnpm test:diff` for the corrected paths.
- Required security/privacy and coverage-write audits, parent final review, and
  the pushed-head ReviewGPT gate.
- `git diff --check`, identifier/privacy scan, corrected-head ReviewGPT, and
  exact-head GitHub aggregate checks.

Completed local proof:

- Focused device-sync regression run: 4 files and 151 tests passed.
- Latest-main conflict verification passed the web, assistant-runtime,
  hosted-execution, and CLI device suites (157, 23, 10, and 21 tests) plus the
  workspace build.
- Final disconnect-evidence and expand-only migration regression run: 8 files
  and 230 tests passed. The built CLI disconnect help directly exposes both
  `--confirm` and `--expected-connected-at`.
- Diff-scoped dependency, workspace-boundary, hosted-runtime, privacy-log, and
  TypeScript gates passed for all 14 affected package/app projects. Affected
  package suites passed; three host-load-sensitive assertions were rerun in
  isolation (CLI assistant 40/40 and setup wizard 1/1).
- The full web workspace completed 4,732 passing tests before load-sensitive
  hook/test timeouts; all five affected files reran serially with 130/130
  passing. The production Next.js build compiled successfully, lint reported
  no errors, and prepared-local dev smoke passed end to end with a temporary
  diagnostic timeout that was reverted before commit.
- Cloudflare verification passed typecheck, runner-image contract, and 97 test
  files / 1,742 tests. The CLI release tarball contract passed 1/1 with a
  temporary diagnostic timeout that was reverted before commit.
- Manual security/privacy review found no medium-or-higher issue. The
  coverage-write audit found and closed malformed non-null lease evidence and
  the incompatible validating migration constraint.
- `git diff --check` and the direct-identifier scan passed.
Completed: 2026-07-13
