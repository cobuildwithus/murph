# Reduce device pass job cost

Status: active
Created: 2026-11-10
Updated: 2026-11-10

## Goal

- Cut autonomous device-sync job-row CPU and wall time, especially replay rows, while preserving exact canonical vault and receipt bytes and foreground preemption.

## Success criteria

- Real service/importer/core benchmark with realistic multimonth ledger and about 80 mixed rows, before/after stage and CPU profiles.
- Differential replay proves identical vault tree and receipts; focused tests and typecheck pass.
- Scoped commits, pushed draft-first PR, ready after exact-head evidence; no deploy or merge.

## Scope

- In scope: device-sync service, importer, core canonical import and transient in-memory optimization where measured.
- Out of scope: query projection publisher, container sizing, same-invocation continuation, persisted index/cache, foreground behavior changes.

## Constraints

- Technical: no cache beyond a pass/lock hold without ledger invalidation proof; external writers and failures must preserve canonical truth.
- Product/process: background cost only; never slow a member reply or move foreground yield points; aggregate diagnostics only, no production mutation or private identifiers.

## Risks and mitigations

1. Stale identity data after another canonical writer: use existing fingerprint/lock invalidation or decline the optimization; compare exact vault bytes across old/new runs.
2. More work before foreground yield: preserve current per-job abort checks and test interruption.
3. Benchmark distortion: use real service/provider/importer path and compare profile frames with production; label unsupported stages.

## Tasks

1. Build and run deterministic synthetic service benchmark, stage timers, CPU profile, and baseline vault manifest.
2. Inspect measured hot path and implement up to three independently justified small cuts, each in its own commit.
3. Rerun paired benchmarks and differential vault/receipt comparison; focused tests, typecheck, complexity and docs checks.
4. Prepare required deployment/skew/rollback evidence, push, create draft PR, wait for draft state, then mark ready.

## Decisions

- UX patch: Outcome: autonomous device data settles sooner with identical canonical records. Reaches: connected-device background drains; conversation preemption remains at existing job boundaries. Proof: real service job sequence, byte-identical vault/receipt manifest, abort and retry tests.
- The existing process cache retains at most 100,000 event rows. A 105,000-row six-month synthetic vault missed on every row, spending about 1.1–1.3 s on the identity stage for both applied and replay rows.
- Reuse the larger index only inside one worker drain. Preserve the process cache for smaller vaults and the existing per-import ledger fingerprint against outside writes; release the large index at drain completion.
- The provider fetch, hosted checkpoint, artifact upload, and projection publisher are outside the local benchmark; no estimate from this fixture will be attributed to those phases.

## Verification

- Benchmark and `node --cpu-prof` profile, exact vault-tree and receipt digest comparison.
- Focused Vitest suites, package typechecks, `pnpm complexity:diff`, repository docs check.
- All output synthetic or aggregate; exact canonical digest match and no foreground-preemption regression.
