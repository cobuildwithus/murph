# Reproduce typing admission latency

Status: completed

## Outcome

Explain missing diagnostic retention and reproduce the boundaries delaying typing
with synthetic inputs. Use existing production diagnostics without copying private
rows, identifiers, or transcripts into repository artifacts.

## Owners and invariants

Account deletion owns mailbox, trace, and runtime-log removal. Alert delivery owns
its separate immutable diagnostic record. The workspace runner owns canonical
receipt durability and admission of the next input. Worker module initialization
precedes route authentication. Preserve these authority boundaries during proof.

## Proof

- Correlate the observed runtime with its deployment and cleanup lifecycle.
- Hold the existing canonical receipt checkpoint and observe assistant admission
  through the real workspace runner; compare with immediate checkpoint completion.
- Profile the real emitted Worker in fresh local workerd processes and compare
  initialization before and after the existing startup optimization.
- Run relevant focused suites and typechecks for retained test or tooling changes.

## Scope

No production mutation or speculative logging. Add instrumentation only when a
specific missing boundary prevents causal attribution. Keep synthetic proof only;
remove temporary experiments that would freeze undesired behavior as a contract.

## Results

- Correlated account cleanup with the separate diagnostic and alert lifecycles.
  Private production evidence remains outside repository artifacts.
- The runner reproduction holds the canonical receipt checkpoint and proves that
  assistant admission follows its completion. All 157 workspace-runner tests pass.
- Three local startup profiles per variant measured a median of 142.654 ms before
  and 104.708 ms after the existing initialization optimization. The experiment
  changed only the two optimized source files and restored both afterward. This
  demonstrates initialization cost, not an exact reproduction of platform delay.
- Existing ingress diagnostics cover encryption-key warming, KMS, database work,
  and direct dispatch. Existing generic slow-transaction warnings start at five
  seconds, leaving shorter checkpoint stalls without query-level attribution.
- Added a bounded, content-free diagnostic for checkpoint transactions taking at
  least one second, reusing the existing Prisma timing collector and formatter.
  It reports acquisition, callback, completion, and operation timings on success
  or failure; diagnostic failure cannot replace the operation's result.
- Web route and diagnostic tests: 114 passed. Assistant-runtime and Web typechecks,
  complexity checks, raw-payload logging guard, and diff whitespace checks pass.
- Three focused encryption-root cache tests pass, covering scoped memoization,
  nested cache reuse, and fresh-scope isolation.
- No member-visible behavior changed, so no public changelog or live assistant
  journey is required. Parent review confirmed unchanged checkpoint authority,
  transaction ordering, and error behavior. No deployment is part of this task.
Updated: 2026-09-20
Completed: 2026-09-20
