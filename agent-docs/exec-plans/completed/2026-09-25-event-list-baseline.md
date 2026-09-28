# Event-list rebuild investigation and baseline handoff

Status: closed; proposed runtime optimization rejected
Requested base: `9da96b607e7ec04925abbc8a1fbb787a7bf7b880`
Source: supplied archive; no Git metadata to independently authenticate its SHA.

## Outcome and plan

Avoid unnecessary event-list projection work without changing results, source
errors, canonical writer isolation or total work in repeated/composed workflows.
Trace the current owners; compare direct-source and existing projection reuse;
author public-boundary synthetic proof; retain runtime changes only with evidence.
No production access, new dependency, cache, persisted projection or scheduler.
Parent owns Git, candidate review and final validation.

## Decision

Reject direct-only and stale-direct/fresh-projection reuse under the requested
no-deferral bound. `listEventRecords` uses `listCanonicalEntitiesRuntime`, whose
stale path holds the canonical writer lock through full source capture and
publication. `readCanonicalEntityFamilySource` itself holds no such lock and
strictly reads only the chosen family. Locking can preserve snapshot exclusion,
but cannot avoid a later global rebuild or amortize event-only source rereads.
`rebuildQueryProjectionFromCanonicalSource` must read that ledger again and still
compute metrics, wearable summaries, search and SQLite publication. No alternate
runtime optimization was substituted. This structural rejection is not an
empirical performance result or an impossibility claim about future designs.

## Delivered proof and limitations

The package README owns reproducible test/type/build and baseline/head commands.
The harness uses one synthetic 3-provider, 365-day fixture, whole-envelope digests,
two warmup pairs and seven alternating measured pairs over four sequence shapes.
Contract tests cover filters, histories, visibility, strict errors and locks.

Executed: five Node benchmark-driver protocol tests passed; both driver files
passed Node syntax checking; both new TypeScript files had zero transpilation
syntax diagnostics with the available TypeScript 5.8.3. These are **not** production
benchmark trials, package typechecks or integration-test results.

Blocked: archive lacks pnpm lockfile, installed dependencies and Frog skill/tool;
Node is 22.16.0, below required 24.14.1. The repository typecheck command rejects
the available TypeScript major (5 rather than 7). Registry DNS is unavailable.
No dependency shim, lockfile regeneration or fake production service was used.
Production-path tests, typecheck, package build and paired benchmark remain unrun;
there are no wall-time or production-speedup claims. No runtime change or
assistant-visible behavior requires a real-Codex replay in this rejection patch.
