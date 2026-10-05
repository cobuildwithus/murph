# Focused projection reads and reusable wearable derivation

Status: active — implementation authored; parent validation/acceptance pending
Created: 2026-10-02
Updated: 2026-10-02
Base: `938664ca9337bf72b4b83aa08f54dfdc0803f928`

## Goal and evidence

Avoid unnecessary full projection work for eight ordinary wearable readers and
reduce repeated expected-empty verification serialization during necessary full
rebuilds, without changing facts, stored/public bytes or freshness semantics.
The supplied metadata-only evidence identifies latest/activity/recovery callers
that still force global work after experiment-list PR3969. The supplied synthetic
profile identifies repeated empty-envelope serialization; neither establishes
this candidate's gain. Timestamp-only invalidation was demonstrated synthetically,
not its production frequency. Existing fractional-mtime/restore behavior is not
being redesigned.

## Scope, owners and decisions

- Query's ordinary helper preserves the old unlocked stored-bundle read only when
  the existing full global status predicate is fresh. Otherwise it delegates to
  the existing locked focused owner and unchanged normal composer/summarizers.
  Sleep keeps its pre-task direct focused read; source-health keeps its focused
  owner and specialized composition. Neither inherits the ordinary fast path.
- Keep strict current validation, reentrant focused capture and atomic wearable
  publication. Do not certify unfinished global work, publish global rows or
  compact for focused reads. Full reads still synchronously rebuild when needed.
  Preserve the old global check/read window and direct stored-read/reset errors;
  do not infer outer-writer commitment from a wearable-only certificate.
- Reuse finite module-private expected JSON strings, not facts or decoded objects.
  Keep actual-envelope byte comparison, fallback and fresh decode allocation.
- Leave sleep-pattern's timezone/metadata ownership and PersonalPatterns unchanged.
  No dependency, telemetry, background/cache owner, restoration change or CLI
  orchestration. The existing CLI process/lock boundary remains authoritative.
- Parent owns Git/PR, independent inspection, builds, measurement, local subscription
  Codex proof and acceptance. The author supplies every tracked patch change;
  Opus's parallel investigation does not change implementation ownership. No
  external write, private-production access, commit, push, merge or deployment.

## Tasks and acceptance

1. [x] Route eight readers through focused freshness when global state is not
   already fresh, preserving the baseline unlocked global path and sleep owner.
2. [x] Remove repeated empty expected serialization without decoder caching.
3. [x] Author eight-reader query/service matrices, independent full-row oracles,
   cold/fresh/partial/stale/correction/deletion, strict errors, provider/date/limit,
   reentrant capture and rollback proof. Adapt the old-version provider fixture
   to require wearable-only certification followed by explicit global promotion.
4. [x] Author exact empty codec bytes, fallback order/extra fields, call counts and
   mutation-isolation tests; retain the extensive existing codec oracle.
5. [x] Author native public-entrypoint paired benchmark and validator controls,
   reusing the unmodified synthetic sleep fixture. Include full output comparison,
   base/base control, two warmup/seven alternating measured pairs, mixed totals,
   per-step phases/CPU and separate stringify probe. No fabricated measurements.
6. [x] Author assembled native CLI JSON/TOON contract and the unique real-Codex
   activity journey with production manifest/prompt/dynamic-tool contracts.
7. [x] Update live owner docs, index and content-only changelog. No measured speed
   claim; the PR number is unassigned, so the fragment does not invent one.
8. [ ] Parent: run all relevant native tests/types/guards and benchmark pairs.
   Confirm actual serialization-call reduction and reproducible whole-rebuild
   improvement beyond control variation, with no skipped/deferred work credited.
9. [ ] Parent: run and inspect the unique live journey on subscription
   `gpt-6.1-sol`; record exact reply/tool/fact/effect evidence. Opus is not the
   runtime model. Close this active acceptance plan only after those gates pass.

## Incremental additions and decisions

- [x] Blood-test list acquisition now delegates to the existing event-only reader.
  Classification/text/status/date/order/limit and alias selectors are unchanged.
  Tests cover cold/fresh/stale/empty, corrections/deletions/reclassification,
  selected-source failures, unrelated-family isolation, lock capture/reentrancy,
  and explicit global work afterward. No meal/measurement/goal scope expansion.
- [x] Browser Vault source health and assistant summaries share one default bundle.
  Personal Patterns shares it only when default filtering removed no entities;
  otherwise its original raw input gets a separate bundle. The public assistant
  wrapper, journal input, timestamps, hash, visibility and four cancellation
  yields stay with their original owners. Tests freeze inputs/bundles, count
  actual derivations, compare full output against independent old consumer inputs,
  and exercise raw/filtered variants and each cancellation checkpoint.
- [x] Investigate one-pass metric aggregation; **defer production deletion** under
  the user's explicit parity exception. Source-derived identity/comparator proof
  finds an accepted noncanonical cross-producer date counterexample. Add a public
  producer regression plus canonical mixed/duplicate/colliding-id differentials.
  Parent reports the actual-path Unicode counterexample PASS. Keep the metric
  implementation deferred; do not alter comparator, accepted-input contract,
  suppression owner or hash to force acceptance.
- [x] Reuse the existing paired driver for blood and raw/default replicas, retain
  all original scenarios, add seven validator controls in total and full-rebuild
  controls against the first packet with the envelope optimization held constant.
- [x] Repair the parent's proved public-export, compatible array lookup, inference,
  union-return, malformed-source code, fictitious activity field and verification
  breadth defects. Add a native blood JSON/TOON and production-manifest contract.
- [ ] Parent: run focused native suites/types, CLI contracts, original live activity
  gate and additions baseline-control/candidate pairs. Confirm full bytes and
  work counts before any gain claim. Keep this same plan active for acceptance.

The supplied metadata-only blood-list aggregate is 11 successful calls totaling
46.894 seconds, including five rebuilds totaling 39.320 seconds (maximum 14.499).
The supplied single synthetic blood probe and five-replica probe establish causes,
not speedups for this candidate. Browser inclusive CPU categories overlap and
must not be summed. No private production records were used in this patch.
Open PR3391's independent journal/source corrections are not incorporated here;
raw and already-filtered direct-input tests preserve compatibility with either
source reader behavior. Personal Patterns consumers are not changed.

## Verification and risks

Commands and the benchmark accounting contract live in
[`global-projection.md`](../../../packages/vault-usecases/bench/global-projection.md).
The author environment has Node 22.16.0, no pnpm/dependencies/built packages/Codex
and unavailable registry DNS. The supplied source ZIP also lacks pnpm-lock.yaml.
First-packet author checks: five benchmark-validator controls passed; workspace-boundary and
package-cycle guards passed; the real changelog fragment parser accepted all 52
editions including the new item. Global TypeScript 5.8.3 parsed the nine changed
TypeScript files without syntax errors; this is not a typecheck. The dependency
guard stopped for the missing lockfile, docs drift for missing repo-tools, and
CLI assembly for missing built CLI output. Runtime suites, full typechecks,
paired timings and the live journey remain unverified; no production PASS or
performance gain is inferred from these dependency-free checks.

Main risks are partial projection accidentally certifying global state, weakened
strict validation, provider/date evidence loss, decoder aliasing, and misleading
mixed-workflow timing. The query/service/codec negative tests and full-byte/phase
benchmark validation target these boundaries. Finite module initialization cost
is charged on cold import. The fresh-global lock regression is repaired below;
retain that scenario and the fallback preflight cost in paired measurements.
No stale-while-refresh policy or optimistic wearable-only capture is introduced. Existing canonical concurrency, rollback,
fractional timestamp and stored-codec tests must continue to pass.


Incremental evidence: the parent reports first-packet dependency build and query/
assistant typechecks PASS, 87 focused query tests PASS with one skipped, and five
validator controls PASS. Its usecase/CLI failures are the specific proof defects
repaired here, not new passing evidence. The author ran seven updated, dependency-
free validator controls on Node 22. Workspace-boundary and package-cycle guards
passed; the changelog parser accepted 52 editions; TypeScript 5.8.3 parsed the ten
changed TypeScript files without syntax errors (not a semantic typecheck). No
native additions suite, paired timing or live run was available. Artifact
application/hashes are separate integrity checks.
The parent subsequently confirmed the actual-public-producer metric counterexample
PASS. No metric-source change is included.


## Fresh-global boundary repair

Outcome: restore the ordinary reader's prior nonblocking fresh-global behavior.
Reaches: all eight ordinary readers; sleep/source retain their focused contract.
Proof: full bytes plus actual lock acquisition, strict fallback, races and timing.

- [x] Reuse the existing complete global status predicate and stored-row reader
  in the ordinary helper only. Keep schema, built-at, both manifests and SQLite
  dictionary/row transaction checks; no broad catch/retry or new owner/state.
- [x] Charge the new preflight and existing fallback recheck as separate freshness
  spans. No benchmark-worker change: retain all 17 scenarios and full workflows.
- [x] Author parked-writer proof for all eight readers, empty providers, focused
  sleep/source controls, partial/missing/schema/reset checks, real commit/rollback
  with reentrant pre-commit wearable publication, post-status canonical writes,
  direct error parity and atomic row/dictionary capture. Extend rollback snapshots
  to include dictionaries. These are authored tests, not new native PASS claims.
- [x] Repair the malformed-goal isolation fixture and cancellation scheduling
  controls without touching production yields; correct the CLI package build
  filter to `@murphai/murph` and retain focused verification commands.
- [ ] Parent: run changed query/browser suites and query typecheck, then preserve
  the existing usecase/CLI proof and measure pairs. Real-Codex and exact-head CI
  remain pending. Keep this acceptance plan active.

Before this repair the parent reports incremental dependency build and four
relevant typechecks PASS, seven validator controls PASS, 17 native scenario
smokes PASS, three CLI contracts PASS and 14 usecase tests PASS. Query/browser
had 35 PASS and the three fixture failures repaired here. The supplied parked-
writer timings prove regression causality only; aggregate waits cannot identify
holders, and neither is a production speedup estimate. The author ran the seven
unchanged validator controls and both workspace guards here. Four changed
TypeScript files parse without syntax errors, not a semantic typecheck. Loading
the browser suite stops at the missing Vitest dependency; no native tests ran.
Native runtime, semantic typecheck and measured acceptance remain unverified.
The preserved old global check/read window may return the prior projection when
a writer starts after observation; the source-only lock is still a limitation.
This is not a new commit protocol or a claim that every fresh read is nonblocking.
