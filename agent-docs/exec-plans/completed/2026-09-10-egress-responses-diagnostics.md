# Extract Responses request diagnostic projection

Status: completed
Created: 2026-09-10
Updated: 2026-09-10

## Goal

Give bounded Responses request diagnostics one explicit module owner so privacy
and classification changes can be reviewed without traversing credential policy.
Preserve diagnostic fields, fingerprints, limits, and provider request behavior.

## Success criteria

- The pure projection and its private implementation move without policy changes.
- Capture, scheduling, response ownership, persistence, and authorization remain
  with the existing interceptor and runtime-log owners.
- Existing diagnostic unit cases target the extracted owner; provider integration
  cases retain authority, streaming, scheduling, and failure coverage.
- Focused Cloudflare tests and typecheck pass; complexity changes are reviewed.

## Scope

- In scope: Responses diagnostic constants/types, request projection, its private
  closure, two model diagnostic selectors shared by request/response capture,
  and direct unit-test placement.
- Out of scope: provider policy, credentials, billing, lifecycle, runtime-log
  schemas, request capture timing, scheduling, and persistence changes.

## Architecture and evidence

`buildHostedOpenAiCacheDiagnostic` accepts bytes and explicit diagnostic inputs.
Its sole production caller is the interceptor's diagnostic emitter. Its local
maps, sets, and fingerprint keys are derived per call; no mutable runtime or
Durable Object state crosses the seam. Existing direct tests already cover
redaction, stable keyed fingerprints, input classifications, and bounded bodies.
The existing hosted-execution runtime-log parser and structured logger retain
validation and emission ownership. No dependency, persistence, or compatibility
layer is needed. The extraction introduces no deployed protocol or state shape.

## Risks and mitigations

- Preserve the HMAC context and exact serialization by moving the implementation
  unchanged and retaining the existing deterministic/privacy assertions.
- Keep both canonical Venice request-model and response-model classification
  with the diagnostic owner; do not expose generic JSON helper functions.
- Keep original provider integration scenarios to protect scheduling, exact-fence
  attribution, and response bytes when diagnostic persistence fails.

## Tasks

1. Extract the concrete projection owner and relocate direct unit cases.
2. Inspect the full diff and prove moved implementation equivalence.
3. Run focused tests, typecheck, and the complexity guard; report any tooling gap.
4. Close the plan and create a scoped candidate commit and draft PR. Parent owns
   candidate review, Ready admission, ReviewGPT, and exact-head CI completion.

## Decisions

- Internal-only refactor: no user-facing journey or changelog entry is needed.
- Individual and group provider-visible input assembly is unchanged; no input
  measurement is claimed.
- No runtime deployment order or rollback floor changes; existing Worker/runtime
  protocols and diagnostics remain byte-compatible.

## Verification

- Passed: `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts
  --maxWorkers 2 --no-coverage
  apps/cloudflare/test/runner-egress-responses-diagnostics.test.ts
  apps/cloudflare/test/runner-egress-intercept.test.ts`: 267 tests in two files.
- Passed: `MURPH_VERIFY_SHARED_HOST=1 MURPH_TSC_PACKAGE_MODE=single-threaded
  pnpm --dir apps/cloudflare typecheck`.
- Passed: static comparison against base `b2a559812972d70644cffb2bf43923fc9211047d`
  confirms all 40 moved function bodies and 33 moved constant initializers are
  unchanged. All 127 retained function bodies are unchanged except the smoke
  reader's renamed private decoder binding. All ten relocated test cases retain
  their exact original statements.
- Passed: `git diff --check` and direct-identifier inspection of task files.
- Reviewed: `pnpm complexity:diff --base
  b2a559812972d70644cffb2bf43923fc9211047d --
  apps/cloudflare/src/runner-egress-intercept.ts
  apps/cloudflare/src/runner-egress-responses-diagnostics.ts` reports the unchanged
  moved `appendOpenAiInputShapeDiagnostics` complexity (31) as new per-file debt.
  Interceptor debt falls by exactly 11; the projection gains that same 11.
  The parent coordinates a separate exact-move guard correction and its single
  Frog entry. No function was fragmented to alter this measurement.

## Implementation handoff

Implementation and focused proof are complete. The scoped commit precedes PR
publication; parent candidate review, the shared guard prerequisite, Ready,
ReviewGPT, and exact-head CI remain explicit readiness gates. The original
OpenAI (34), Venice (24), and provider-egress diagnostic (25) hotspots remain
unchanged in the interceptor; the request-shape hotspot (31) stays cohesive in
its new diagnostic owner.
Completed: 2026-09-10
