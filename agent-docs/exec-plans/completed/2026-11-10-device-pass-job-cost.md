# Reduce device pass job cost

Status: completed
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

## Outcome and evidence

- The real service/importer/core synthetic pass uses 105,000 device-origin event rows in six monthly shards and 80 durable resource/reconcile job rows, half exact replays. Its provider executor is local; hosted checkpoint, artifact upload, query projection, and provider network waits are excluded.
- For the same seeded vault, unscoped versus scoped median applied row: wall 1,162 to 44 ms, process CPU 1,409 to 50 ms, identity stage 1,112 to 0.4 ms. Replay row: wall 1,153 to 39 ms, CPU 1,397 to 54 ms, identity 1,111 to 0.4 ms. The first row still builds the index. All 80-row canonical vault and receipt bytes matched by SHA-256 manifest; the differential test reruns the sequence in both modes.
- Peak local process RSS rose from about 1.06 GiB to 1.76 GiB. This is below the 6 GiB runner provision but requires hosted observation. The existing fingerprint rejects unobserved ledger changes, and the new scope clears at drain completion, including foreground yield or failure.
- A profile of eight unscoped jobs showed about 11.2 process CPU-seconds against about 6.1 seconds of main-thread active samples. This synthetic path starts no worker isolate. V8 helper versus libuv CPU remains unattributed; production's 44% off-main CPU cannot be fully split from this run.
- Six-day aggregate runtime logs: 5,385 passes and 107,904 processed job rows. The bounded slow-job summaries contain 44,506 rows and 5.23 hours of identity-index time, but are truncated toward slow jobs. Among sampled passes, 101 had at least two expensive uncached identity stages; 608 stages beyond one per pass totaled 5,916.5 seconds over six days. At the measured local CPU/wall ratio and listed container rates, converting all of those sampled repeats would be about $0.04/day. Truncated rows and the unknown 100,000–150,000-row vault share prevent a fleet estimate; the earlier $0.5/day hypothesis is not established by this cut.
- Sampled canonical write time totaled 12.30 hours over six days, while local writes took about 5 ms. Hosted receipt publication and checkpoint persistence run inside the canonical-write stage, so the local benchmark cannot attribute or safely remove those save-before-effect costs. Query projection work remains with its separate owner.
- Product UX walkthrough: a scheduled device pass still checks the existing yield/abort points before import publication and between jobs; the 205-test service suite includes foreground cancellation and retry paths. No member-visible output or authority changed. Hosted foreground-arrival latency and the RSS distribution after deployment remain unproved.
- Focused core cache tests (11), device-sync service tests (205), hosted/backfill tests (125), the byte-for-byte differential test, all three package typechecks, benchmark typecheck, and complexity guard passed. No production mutation, deploy, or ReviewGPT was performed.
Completed: 2026-11-10

- The synthetic pass benchmark that produced these numbers is not checked in: it imported `@murphai/core` from the device-syncd package, which the workspace boundary check rejects. The differential guarantee in the tree is `packages/core/test/device-import-cache-invalidation.test.ts`.
