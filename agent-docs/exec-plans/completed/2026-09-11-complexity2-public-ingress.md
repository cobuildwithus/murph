# Simplify OAuth callback admission and cleanup

Status: completed
Created: 2026-09-11
Updated: 2026-09-11

## Outcome and protected invariants

Make callback state admission and cleanup precedence easier to review. Preserve
provider/member binding before state consumption, consumed-state replay and
recovery behavior, seeded connection epochs, source-scoped cleanup, credential
policy, and persistence/hook ordering. No callback cookie or public API changes.

## Evidence and owner

The callback has cyclomatic complexity 96. It reconstructs the same redirect
context four times, wraps three cleanup branches identically, and repeats failed
provider-authority cleanup. DeviceSyncPublicIngress and its existing store/hooks
remain the owners; no new persisted state, dependencies, or generic orchestration.

## Scope and decisions

- Give OAuth state consume/discard admission one private method and derive its
  callback context once after provider/owner/state validation.
- Consolidate identical cleanup and error wrapping while preserving source,
  persisted connection, disconnect-guard, and seeded-account precedence.
- Keep unresolved-claim recovery and its existing error behavior in place.
- Leave prepared-webhook admission untouched; its authority decisions are separate.

## Proof

Run full public-ingress and Junction SDK sign-in tests with bounded workers, the
package typecheck, and the complexity guard. The existing public tests cover
replay/query tampering, owner/provider mismatches, seeded epoch/disconnect races,
credential policy, source admission, and provider-revoke/cleanup ambiguity.
Inspect the complete diff for effect ordering, privacy, and unjustified machinery.

## Progress

- Read-only investigation and owner review complete.
- Implementation complete: one state-admission phase, one redirect-context
  builder, one source-context projection, and consolidated cleanup branches.
- Redirect-context construction stays at the selected outcome so persisted-return
  sanitization keeps its original warning and error ordering.
- `MURPH_VITEST_MAX_WORKERS=1 pnpm --dir packages/device-syncd exec vitest run --config vitest.config.ts --no-coverage test/public-ingress.test.ts test/junction-sdk-sign-in.test.ts`
  passes all 90 tests against the final source.
- `MURPH_TSC_PACKAGE_MODE=single-threaded pnpm --dir packages/device-syncd typecheck` passes.
- `pnpm complexity:diff --base HEAD -- packages/device-syncd/src/public-ingress.ts`
  passes: callback/max 96 to 71; file debt 144 to 119. Callback 71 retains its
  effect and cleanup sequence; unchanged webhook 71 and connection start 37 are
  separate authority boundaries. Further extraction would require unnecessary
  mutable callback context or a broader task.
- Full diff, privacy, and effect/error precedence reviewed. Existing public
  regression coverage is sufficient; no implementation-mirroring tests added.
- Parent owns candidate review, Ready, ReviewGPT, CI, and merge.
- Internal behavior-preserving refactor; no changelog entry required.
Completed: 2026-09-11
