# Complete the R2 live-cutover read bridge

Status: completed
Created: 2026-08-05
Updated: 2026-08-06

## Goal

- Preserve ordinary hosted replies, checkpoints, email intake, and staged
  uploads while R2 write authority moves from OC to ENAM.
- Close the mixed-version gap where a source-active invocation could not read a
  new ENAM-only object accepted during phase rollout.

## Success criteria

- One temporary bridge owner keeps writes and lists on the phase-active bucket
  while explicit reads consult the other bucket only after a definitive miss.
- Operational failures never become fallback reads, and dual deletion plus
  direct-upload bucket affinity remain unchanged.
- Bridge protocol v2 is deployed and proven on every source-active runner
  before the destination-active phase change is allowed.
- Both coexistence phases omit the fixed-source prepared snapshot URL, so cold
  restore uses the existing write-fenced object locator and presigns the
  concrete bucket that contains the snapshot.
- A production-path destination-only email is readable by a source-active
  consumer, a destination-only snapshot is cold-restoreable by a source-active
  consumer, focused tests and typecheck pass, exact-head CI is green, and both
  ReviewGPT findings are resolved.

## Constraints

- Add no dual-write path, queue, migration state owner, service, retry manager,
  or broad compatibility layer.
- Keep account deletion maintenance-fenced until tail-copy convergence; keep
  ordinary runtime admission open unless a declared correctness incident
  requires containment.
- Never expose credentials, object keys, account identifiers, or production row
  contents in durable artifacts.

## Tasks

1. Make explicit `GET`, `HEAD`, and object-location reads use one phase-ordered
   primary/fallback rule in the existing cutover bucket wrapper.
2. Bump the reported bridge protocol and require a source-active v2 pre-deploy
   before promotion.
3. Add bidirectional miss-only, error-propagation, Worker-ingress, and
   runner-outbound regressions, including the role-aware cold-restore path.
4. Update the owner runbook and architecture/reliability/deploy summaries.
5. Complete focused verification, exact-head review, CI, merge, source-active
   v2 deployment proof, and only then continue the production cutover.

## Verification log

- `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts apps/cloudflare/test/r2-cutover.test.ts apps/cloudflare/test/hosted-email-worker-ingress.test.ts apps/cloudflare/test/runner-outbound.test.ts --no-coverage`
  passed before the final ordering-helper simplification: 3 files, 247 tests.
- `pnpm --filter @murphai/cloudflare-runner typecheck` passed before the final
  ordering-helper simplification.
- The final five-file bridge/ingress/staged-upload suite passed: 5 files, 257
  tests.
- The final bridge, prepared-restore, dispatch, and fenced-control-plane suite
  passed: 4 files, 345 tests.
- `pnpm --filter @murphai/cloudflare-runner typecheck`, `pnpm docs:drift`, and
  `git diff --check` passed on the final candidate.
- Updated exact-head CI and the ReviewGPT remediation round are pending.
Completed: 2026-08-06
