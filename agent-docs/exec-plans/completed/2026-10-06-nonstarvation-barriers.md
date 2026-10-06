# Deterministic reminder and device-sync overlap proof

Status: completed
Created: 2026-10-06
Updated: 2026-10-06

## Goal and invariant

Prove one recurring reminder runs while a positive receipt-bounded device pass
has durable backlog, then prove all dirty resources drain without job failures.
Preserve the single-admission window, positive bounded work, and exactly-once
reminder assertions. This is test orchestration only; no production change.

## Evidence and design

An idle shutdown checkpoint does not imply a new device pass. Immediately
rearming that barrier after a zero-job pass can trap a housekeeping publication
and wait for a pass that cannot start. The advanced log cursor correctly excludes
the already-consumed pass. A reminder due time also cannot bound asynchronous
telemetry delivery once publication is already held.

Reuse the existing canonical post-commit gate before every publication gate,
including retries after empty passes. Arm it before releasing the previous
publication, let housekeeping settle, and wait for the next pre-drain fence.
Keep log observation bounded by its own observation timeout. No new runtime
state, test-control API, dependency, or production scheduling behavior.

## Scope and constraints

Only the public scenario, a test orchestration helper, focused barrier proof,
and this execution record/index entry. Private worker is used unchanged.
Local commit only; no push, PR, deployment, or production access. All fixture
members and resources are synthetic. No changelog: internal test-only change.

## Tasks

1. Compare failure/pass ordering and trace the checkpoint and log owners. Done.
2. Re-arm through the existing pre-drain gate and preserve cleanup. Done.
3. Exercise real barriers with an intervening housekeeping checkpoint. Done.
4. Run Cloudflare typecheck, local scenario repetitions, diff/complexity/docs checks. Done.
5. Review and commit locally through finish-task; record unverified boundaries. Done at closeout.

## Verification

- Focused barrier and admission tests: 34 passed.
- Cloudflare typecheck: passed.
- The focused real-barrier regression fails with the old immediate rearming and
  passes with the next-pass fence.
- Baseline scenario passed locally (539.90 seconds). Fixed run 1 passed with
  two CPUs per owned runner container (586.68 seconds); run 2 also passed
  (671.25 seconds). Run 3 passed (519.02 seconds). All container CPU-limit updates succeeded;
  the runs constrained eight, seven, and six containers respectively.
  This is container pressure, not a complete two-vCPU host reproduction.
- Parent diff/ownership/privacy review and `git diff --check`: passed.
- `pnpm complexity:diff`: passed; the metric excludes test-only files and found
  no production JS/TS source changes. No production complexity was added.
- `pnpm docs:drift` and `pnpm docs:gardening`: passed (zero gardening issues).
- After the measured scenarios, one indentation-only cleanup was followed by
  another Cloudflare typecheck and the same 34 passing focused tests; executable
  scenario behavior was unchanged.
- Full before-fix scenario failure was not reproduced locally. The old barrier
  ordering fails the focused real-handler regression; the baseline E2E passed.
- No Linux two-vCPU whole-host reproduction or hosted CI run was performed.
  Local Docker runs use AMD64 emulation on an ARM64 host. No push/PR/deploy was
  requested or performed. Private worker source remains unchanged.
- No member-facing changelog or external review: this is internal test-only
  orchestration, with production handlers and contracts unchanged.
Completed: 2026-10-06
