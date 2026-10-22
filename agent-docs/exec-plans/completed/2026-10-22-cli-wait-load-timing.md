# Attribute CLI lock wait and importer loading

Status: completed
Created: 2026-10-22
Updated: 2026-10-22

## Goal

Attribute two existing waits inside CLI `dispatch` that current timing cannot
separate: canonical-write lock acquisition and the importers module import.
This is diagnostic telemetry only. It is not a performance fix and makes no
causal claim about the earlier unattributed `meal add` dispatch.

## Success criteria

1. `canonical-write-wait` covers each `acquireCanonicalWriteLock` call from
   entry until the handle returns or acquisition throws: queue slot,
   cross-owner polling and timeout or stale rejection. It never covers lock
   hold, guarded work or release.
2. `importers-runtime-load` covers each existing `loadImportersRuntimeModule`
   native import call. No cache, retry, eager import or extra call is added.
3. Results, thrown error identity, queueing, re-entry, timeout, stale handling,
   release and queue-slot cleanup are unchanged. Both phases are no-ops outside
   a CLI timing scope.
4. The phases are appended to the existing finite catalog. Schema, buckets,
   caps, transport and trimming are unchanged; the only new observations are
   bounded timing scalars under two fixed names.
5. Actual-base reader skew is proven and documented: old readers reject the
   whole optional timing object, so readers deploy first.

## Scope

- In scope: `runtime-state` catalog; one `timeCliPhase` wrapper each in core
  `canonical-write-lock.ts` and vault-usecases `usecases/runtime.ts`; focused
  tests at those owners; the telemetry guide, runtime-state README, index and
  this plan.
- Out of scope: lock or loader behavior, other locks (`withCanonicalResourceLocks`,
  query `query-wait`), mailbox or inbox timing, typing thresholds (2500 ms warm,
  7000 ms cold) and timing origins, provider and model behavior, deployment.

## Constraints

- Technical: reuse `@murphai/runtime-state/node/cli-timing` by its public
  specifier, which is already a runner-bundle external and already imported
  statically by query and vault-usecases. No dependency, manifest, transport or
  state change.
- Process: the parent owns execution, tests, review, commit, PR and release.
  The typing owner's combined rollout is on hold, so no merge or deploy is
  authorized here. All fixtures are synthetic.

## Risks and mitigations

1. Risk: old readers drop the whole `cliTiming` object on an unknown phase.
   Mitigation: deploy readers first (Web, then Worker), then the runner image,
   which contains both producers and the receiver. A history-backed test pins
   the old-reader behavior.
2. Risk: re-entrant acquisitions inflate `count` and `sumUs`.
   Mitigation: this is documented as acquisition calls, not holds; use
   `maxUs` and the histogram for real waits. Tests pin a count of 2 for one
   re-entry.
3. Risk: extra spans per write consume the 64-span budget.
   Mitigation: the existing `droppedSpans` accounting is unchanged and its
   interpretation is documented.
4. Risk: core's new static import enters runner bundles.
   Mitigation: the specifier is an existing shared external, not inlined, so
   the forbidden-input marker for the inlined dist path still applies. Focused runner-bundle proof checks this boundary; exact-head CI owns
   the full package and runner assembly.

## Tasks

1. Done (author): append the two names to `CLI_TIMING_PHASES`.
2. Done (author): wrap acquisition in core and the importer import in
   vault-usecases.
3. Done (author): add behavior tests and the old-reader compatibility row, and
   update the catalog pin.
4. Done (author): update the telemetry guide, runtime-state README and index.
5. Done: focused verification and parent candidate review. Exact-head CI and
   independent final ReviewGPT remain PR gates. Merge and release remain held
   for the existing release coordinator; this record is not rollout approval.

## Decisions

- Measure inside `acquireCanonicalWriteLock`, the single choke point that
  `withCanonicalWriteLock`, `WriteBatch.commit` and `rollback`, inbox
  persistence and retention all reach. A process-local held-owner registry to
  skip re-entry would add state, so re-entrant samples are retained and
  documented instead.
- Sample every importer loader call. Adding a shared promise to make it
  cold-only would change loader semantics.
- Append both names last so prefix-based actual-base tests stay valid.

## Verification

- Commands to run:
  - `pnpm --dir packages/runtime-state exec vitest run --config vitest.config.ts --no-coverage test/cli-timing.test.ts`
  - `MURPH_CLI_WAIT_LOAD_PHASE_COMPAT_BASE=3675d4251fadc830de698d5c41294d206dfd22e1 pnpm --dir packages/runtime-state exec vitest run --config vitest.config.ts --no-coverage test/cli-timing.test.ts -t "pre-wait-load"`
  - `pnpm --dir packages/core exec vitest run --config vitest.config.ts --no-coverage test/canonical-write-lock.test.ts test/canonical-write-lock-parallel.test.ts`
  - `pnpm --dir packages/vault-usecases exec vitest run --config vitest.config.ts --no-coverage test/runtime.test.ts`
  - `pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts --no-coverage test/cli-timing-transport.test.ts test/cli-timing-profile.test.ts`
  - `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --no-coverage apps/cloudflare/test/usage-record-port.test.ts apps/cloudflare/test/runner-bundle-cli-bundle.test.ts`
  - `pnpm --dir packages/runtime-state typecheck`, `pnpm --dir packages/core typecheck`, `pnpm --dir packages/vault-usecases typecheck`
  - Required exact-head CI owns full package/runner assembly and static-closure guards.
- Expected outcomes: all pass. The compatibility test shows the base reader
  returns `null` for each new phase and accepts legacy reports. No timing
  thresholds are asserted beyond controlled-clock exact values.
- Parent verification (Node 24.22.1):
  - Runtime-state timing and terminating-process suites: 66 passed, 17 unrelated
    historical-compatibility cases skipped. The actual-base wait/load row ran.
  - Core lock and cross-process lock suites: 13 passed.
  - Vault-usecases runtime suite: 15 passed.
  - Assistant timing transport/profile suites: 19 passed initially. Parent
    extended the existing history-backed profile test to prove old-reader
    token/accounting preservation for both new phases; final profile suite:
    13 passed, 7 unrelated historical-compatibility cases skipped.
  - Cloudflare usage-record-port and runner-bundle-cli-bundle suites: 23 passed.
  - Typechecks passed for runtime-state, core, vault-usecases and assistant-engine.
  - Complexity guard passed for all three changed source files, zero hotspots
    above 20; documentation drift and whitespace checks passed.
- Parent review: fixed fields only, unchanged lock body and loader calls,
  no new network or database operation, existing collector and bundle external
  reused. Re-entry and sample-cap interpretation are explicit. No customer data,
  incident duration, local path or raw diagnostic is in the patch.
- Delivery status: no merge or deployment. Exact-head CI and independent review
  will be reported on the PR. No production speedup or historical cause is proven.
Completed: 2026-10-22
