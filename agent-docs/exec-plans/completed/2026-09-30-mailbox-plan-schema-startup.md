# Remove unused plan schemas from mailbox startup

Status: completed
Created: 2026-09-30
Updated: 2026-09-30

## Goal

Remove measured schema initialization from mailbox startup using existing owners,
without another service, native function, request, cache or configuration flag.

## Evidence and decision

- CPU profiling the emitted production route showed substantial Zod initialization.
- The only retained Zod import in a diagnostic mailbox bundle came through Web
  billing-plan definitions importing a display label from the plan-usage module.
- Reusing the existing dependency-free runtime values module for that label lets
  Web use its existing runtime-control import. Keep the old plan-usage export
  as a re-export so other callers and published contracts remain compatible.
- The diagnostic bundle lost all Zod code. The actual Next production artifact
  and complete cold request comparison must establish the implementation gain.

- The first real Next build showed that moving the label alone was insufficient:
  unused runtime-control re-exports still initialized unrelated contract schemas.
  Mark the declarative hosted-execution package side-effect-free so Webpack can
  discard those unused modules; audit module initialization before accepting it.
- Next defers userland initialization. Diagnostic import-only timings do not
  include that work. Use complete HTTP requests and ensureUserland when profiling.

- Move the derived group-email share limit beside its source projection catalog
  in vault-share and preserve its runtime-control re-export. This removes the
  remaining eager catalog read from generic runtime initialization.
- Opus audited all 71 hosted-execution source modules and found no required
  import-time effects. A parent AST scan likewise found only declarations.

## Invariants

- The Core display label and all billing/access decisions remain identical.
- No signature, replay, runtime fence, transaction, cursor or response changes.
- Preserve the existing plan-usage export and use public workspace entrypoints.
- Keep request timing boundaries and log emission conditions unchanged.
- No private production rows, identifiers or local paths in tracked artifacts.

## Tasks

1. Move the existing label to runtime-control-values and re-export it from both owners.
2. Remove the schema-module import from Web billing-plan definitions.
3. Compare real emitted Next startup with the saved baseline using synthetic inputs.
4. Run focused package/Web tests, typechecks and complexity/docs checks.
5. Review the final pushed PR, pass CI, merge and deploy through managed admission.
6. Inspect production timing and report the measured gain or remaining uncertainty.

## Verification

- Final hosted-execution build and full Web production build passed, including
  Web typechecking, trace checks and relocated emitted OG runtime checks.
- Hosted-execution full suite: 805 passed, one existing skip. After the final
  catalog move, focused parser/plan/runtime suites passed all 160 tests.
- Web billing, group-email authorization and mailbox timing suites: 41 passed.
  The group-email bound remains 99 and the plan display label remains Core.
- Twenty alternating fresh-process trials against actual emitted Next builds:
  first rejected HTTP request median 334.59 ms before versus 241.84 ms after
  (27.7% lower); CPU median 467.11 versus 292.18 ms (37.4% lower). Each trial
  asserted the same expected missing-callback-identity response. Three subsequent
  requests per process had medians 2.36 and 2.43 ms respectively.
- These synthetic requests cover startup through handler entry, not successful
  production authentication/database work. They do not establish hosted latency.
- Referenced route/shared JavaScript fell from 976,083 to 722,123 bytes. This is
  the route closure, not the complete Vercel function artifact. Factory profiling
  confirmed that the heavy unrelated contract-schema initializer no longer runs.
- Complexity passed against the task fork point. The unchanged runtime-control
  diagnostic inspector (25) and vault-share parser (30) remain existing hotspots;
  this patch moves constants and adds no branches to either.
- Post-deploy production evidence remains pending release admission. No native
  adapter, warmup traffic, service, cache or additional network call was added.
Completed: 2026-09-30
