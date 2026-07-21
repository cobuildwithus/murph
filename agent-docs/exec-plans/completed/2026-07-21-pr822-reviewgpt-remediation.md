# PR 822 ReviewGPT remediation

Status: completed
Created: 2026-07-21
Updated: 2026-07-21

## Goal

- Preserve the measured capable-host local acceptance speedup while making the
  root verifier the sole owner of Crabbox app-step scheduling, restoring the
  conservative ordinary shared-host typecheck default, and making the retained
  cross-command ownership explicit and regression-tested.

## Scope

- `scripts/crabbox/run-verification.mjs` and its focused environment tests.
- `scripts/workspace-verify.sh` and focused scheduler/profile tests.
- Assistant Engine fake-time process-stop regression proof.
- Current verification docs, Crabbox skill guidance, and PR intent contract.

## Invariants

- Capable local and standard 16-vCPU Testbox acceptance retain the composed
  profile; smaller hosts and CI remain conservative.
- Ordinary shared-host commands do not inherit acceptance-only fanout.
- The sanitized Crabbox environment remains synthetic and secret-free.
- The root verifier alone decides Web-parallel versus Cloudflare-serial app
  steps for composed acceptance.
- CLI terminal success or failure releases app waiters without hiding the CLI
  result, and the readiness path remains invocation-scoped.

## Verification

- Focused Crabbox, workspace scheduler, Assistant Engine, and release-audit
  tests.
- `pnpm test:repo-tools`, scoped `pnpm test:diff`, docs drift, and required
  coverage-write audit.
- Fresh local and Crabbox acceptance timing samples on the corrected profile.
- ReviewGPT correction round and final-head CI.

## Results

- Corrected capable-host local acceptance passed in 232.17s end to end with the
  16-vCPU composed profile.
- Corrected standard 16-vCPU Blacksmith Testbox acceptance passed in 224.99s
  verifier time and 269.01s end-to-end dispatcher time. The remote verifier was
  about 3% faster than local; the 36.84s end-to-end difference was remote
  allocation, checkout, targeted sync, install, and teardown overhead.
- The corrected remote trace proved the root-owned readiness boundary: Web's
  Next build and Cloudflare app tests waited for CLI coverage before release.
- Focused Crabbox/workspace tests passed (31 tests), the Assistant Engine
  fake-time bound regression passed, `pnpm test:repo-tools` passed (409 tests),
  the release audit passed (37 passed, 1 skipped), docs drift passed, and the
  scoped `pnpm test:diff` passed in 525s across every selected owner.
- The required coverage-write audit returned PASS with no findings.
Completed: 2026-07-21
