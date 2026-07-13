# PR 554 final audit corrections

Status: active
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
- Truthful `apps/web` diff verification passed dependency and workspace guards,
  4,571 tests, lint with no errors, dev smoke, TypeScript, and the production
  Next.js build.
- `git diff --check` and the direct-identifier scan passed.
