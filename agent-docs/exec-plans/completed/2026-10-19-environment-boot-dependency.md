# Preserve runner schema runtime during Environment removal

## Objective

Keep PR #4211's Environment removal while preserving the runner's existing
schema runtime and startup performance. No performance-budget relaxation.

## Evidence and decision

- Exact-head native CI repeated a boot CPU regression: baseline about 1,321 ms,
  candidate about 1,690 ms; seed/new import scenarios passed.
- Both production bundles loaded the same external SDK modules. The candidate
  was smaller, but removing Cloudflare's unused OpenAI dependency removed the
  only production-closure lockfile reference to Zod 4.5.4. Standalone assembly
  consequently resolved Zod 4.4.3 instead of the baseline's 4.5.4.
- Local alternating bundle runs reproduced the difference: baseline 793–826 ms,
  candidate 1,011–1,055 ms. Rebundling the unchanged candidate with only Zod
  restored to 4.5.4 measured 755–768 ms.
- Raise the existing workspace Zod minimum to 4.5.4; the lockfile pins 4.5.4. Contracts exports schema
  types across packages; a contracts-only update failed the build because Zod
  4.4 and 4.5 encode incompatible minor-version types. Keep the shared runtime
  coherent rather than introducing casts or an assembly-only override. Retain the
  existing dependency and assembly machinery; do not retain dead OpenAI wiring
  or add a special bundler override.

## Work and validation

- [x] Align existing workspace declarations and regenerate the lockfile.
- [x] Rebuild the normal production bundle and verify one shared Zod runtime.
- [x] Run contracts tests, affected typechecks, and dependency/bundle guards.
- [x] Ask Claude to assess the dependency fix against the measured evidence.
- Local implementation complete; scoped commit and exact-head external gates follow.

## Product and deployment

No additional user-facing change. Environment remains removed; the hosted
preview returns 404 for `/environment`, and the navigation study returns 200
with the retained destinations. No production deployment or database mutation.

## External gates

PR #4211 round one passed ReviewGPT at `11d278f94aa7`. New-head native CI and
ReviewGPT remain required; record their final results in the PR evidence.

## Compatibility review

Claude reviewed the dependency diff and accepted the coherent version alignment.
Retain the existing caret-range convention for published workspace consumers.
Generated artifacts now match the runner's already-deployed 4.5.4 semantics:
ISO datetimes require seconds, and nullable primitive unions use equivalent
JSON Schema type arrays. Local consumers previously using 4.4.3 also acquire
those datetime semantics; existing contract tests and generated-artifact checks
are part of verification. No custom compatibility parser is introduced.

## Final local evidence

Contracts: 392 tests, typecheck, and generated schema/example verification pass.
Runner dependency/entrypoint guards: 60 tests pass. Production assembly rebuilds
all 25 runtime workspace packages and passes CLI parity and boot probes. The
normal bundle has one Zod 4.5.4 runtime (unchanged isolated v3 dependencies stay).
Alternating normal-bundle boot CPU medians: candidate 780 ms, baseline 869 ms.
Exact-base emitted-output comparison passes: runner -31,239 bytes; CLI -4,659
bytes. Frozen install passes. Native Linux latency remains the authoritative
external gate; local timings establish the causal dependency fix.

Web typecheck, documentation drift, and whitespace checks pass.
Status: completed
Updated: 2026-10-19
Completed: 2026-10-19
