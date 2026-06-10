# Cold-start boot trims and dispatch-gap instrumentation

## Goal

Cut measured hosted cold-start latency (message accept → provider start, ~13s
p50) on its two cheapest axes and make the remaining uninstrumented dispatch
gap measurable, without adding new state, data paths, or orchestration
authority.

Success criteria:

- Container image bakes a warmed `NODE_COMPILE_CACHE` so cold-boot V8
  parse/compile of the unbundled `node_modules` + `dist` tree is cached at
  image build instead of paid per cold start (`nodeStartupMs` ~3.7s avg today).
- The deploy-smoke-only modules (`hosted-runner-smoke-contract.ts`,
  `hosted-assistant-bootstrap`) stop loading on the job path; they load lazily
  inside the smoke handler only.
- `phaseBreakdown.dispatch` carries two DO-side epoch-ms stamps
  (`invokeReceivedAtEpochMs`, `containerStartRequestedAtEpochMs`) so the
  `temporal_signal_accepted_at` → `runner_job_accepted_at` gap decomposes into
  DO dispatch vs Cloudflare container scheduling in
  `hosted_ingress_latency_trace`, using only the existing strict
  phase-breakdown parser and idempotent web merge.

## Constraints

- Temporal stays the only wake authority; no new wake/nudge paths.
- No new persisted state classes: dispatch stamps ride the existing
  `phaseBreakdownJson` (schemaVersion 1) through the existing strict parser
  (numbers only; secret-safety leaf guard unchanged).
- Minimal textual touch on `apps/cloudflare/src/runner-container.ts` (active
  ledger lane on destroy/lifecycle symbols): stamps + two request headers on
  the existing containerFetch POST only.
- The restore/boot overlap optimization (presign-before-start) is explicitly
  out of scope; decide later with the new dispatch data.

## Approach

1. `Dockerfile.cloudflare-hosted-runner`: set `NODE_COMPILE_CACHE=/app/.node-compile-cache`,
   warm it via a guarded `import()` of `dist/container-entrypoint.js` before
   the read-only chmod (the `isHostedContainerCliEntrypoint()` guard keeps the
   warm import from starting the server).
2. `container-entrypoint.ts`: move the two smoke-only imports to dynamic
   imports inside `runHostedContainerCliSurfaceContractSmoke`.
3. Dispatch stamps: `runner-container.ts` stamps `Date.now()` at
   `invokeHostedExecution` entry and immediately before `ensureContainerReady`,
   sends both as `x-dispatch-*` headers on the runner POST;
   `container-entrypoint.ts` reads the headers and threads them through the
   existing invocation options; `hosted-workspace-invocation.ts` includes them
   in the staged `phaseBreakdown`; `@murphai/hosted-execution` type + strict
   parser gain the `dispatch` subkey; web store merge list adds `"dispatch"`.
4. Focused tests: parser accepts/rejects dispatch shapes, entrypoint passes
   headers through, web merge persists dispatch idempotently, Dockerfile
   contract test updated for the new warm step.
5. Scoped verification + required completion audits, then PR.

## State

Active.
Status: completed
Updated: 2026-06-10
Completed: 2026-06-10
