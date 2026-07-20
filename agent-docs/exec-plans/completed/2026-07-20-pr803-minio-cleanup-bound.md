# PR 803 MinIO cleanup bound

Status: completed
Created: 2026-07-20
Updated: 2026-07-20

## Goal

- Resolve ReviewGPT round three by making every best-effort MinIO Docker cleanup
  command settle within an owner-local bound.
- Preserve the suite's single invocation-local termination and admission owner.

## Success criteria

- A hung Docker listing or removal command is terminated only through the exact
  child handle created by the current invocation.
- Both MinIO cleanup APIs settle after the bound and keep their existing
  best-effort return semantics.
- Persistent SIGINT, SIGTERM, and SIGHUP handlers cannot make suite cleanup
  unkillable or admit later scenario work.
- Focused MinIO and suite process tests, owner verification, CI, and ReviewGPT
  round four pass.

## Scope

- MinIO best-effort Docker command ownership and timeout tests.
- A focused suite-level regression if needed to prove the bound composes with
  repeated parent-only termination signals.
- PR review metadata and exact-head verification.

## Constraints

- No host-wide process discovery, name matching, process manager, registry,
  queue, or persisted cancellation state.
- Signal or force-terminate only the retained Docker child spawned by the
  helper under test.
- Keep cleanup best-effort and preserve unrelated MinIO startup behavior.

## Verification

- Focused MinIO timeout tests for capture and removal commands.
- Focused suite/process regression for repeated signals during cleanup.
- Hosted-local typecheck, owner coverage, truthful diff verification, required
  coverage-write audit, exact-head CI, and ReviewGPT round four.

## State

- ReviewGPT round three returned one review-induced High: persistent suite
  handlers can consume repeated signals while the private MinIO Docker helpers
  await an unbounded child exit.
- Root-cause inspection confirms both private best-effort helpers retain the
  exact child handle but have no timeout or abort settlement path.
- Both helpers now share a 10-second owner-local settlement bound that sends
  `SIGKILL` only through the exact retained Docker child handle and preserves
  empty/void best-effort results.
- Unit tests cover hung removal and listing commands, early errors, and late
  exit/error idempotency. A real suite subprocess accepts two distinct parent
  SIGTERM deliveries while MinIO cleanup is hung, exits with code 143 within
  the bound, and admits no Vitest work.
- Focused remediation tests pass 35 tests across MinIO, suite admission, and
  process ownership. Hosted-local typecheck and owner coverage pass with 406
  tests and 1 skip at 84.03% statements, 75.60% branches, 83.74% functions,
  and 84.00% lines.
- Truthful diff verification passes for hosted-local and Cloudflare owners,
  including 1,842 Node tests and 1 Workers test. The required coverage-write
  re-audit found no remaining gaps. Exact-head CI and ReviewGPT round four
  remain before final PR handoff.
Completed: 2026-07-20
