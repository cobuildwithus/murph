# Benchmark and optimize encrypted workspace restore

Status: completed
Created: 2026-09-04

## Outcome and invariants

Measure a synthetic 50 MiB encrypted snapshot through the production restore
port, then retain only optimizations supported by repeated measurements.
Authentication, ciphertext/plaintext hashes, byte limits, cancellation, and
atomic durable-root replacement must remain intact.

## Product UX

- Outcome: reduce healthy cold workspace restore latency.
- Reaches: returning conversations requiring a cold restore.
- Proof: identical restored content plus measured before/after stage timings;
  cancellation, corrupt archives, and exhausted retries preserve prior files.

## Current owner and experiment

Cloudflare workspace snapshot port owns download/retry; workspace-snapshot-local
owns authenticated decrypt, zstd/tar extraction, and replacement. A local HTTP
server substitutes object storage; synthetic unwrap/presign responses substitute
control-plane access. No remote state, private fixtures, credentials, or provider
turns are needed. Default fixture mixes 50 MiB incompressible bytes with 75 MiB
repeated bytes across 1,000 files. Construction and hash readback are untimed.

Establish an unmodified baseline first. Compare identical artifacts/settings in
serial runs, including Linux containers with a fixed CPU quota if available.
Track decrypt, extract, cleanup, wall, CPU, and memory separately. Local HTTP
and cached local storage do not reproduce Cloudflare placement, TLS, or R2 tails.

## Decisions and proof

- Inspect repeated encrypted-buffer copies as one bounded candidate; do not
  weaken authenticate-before-extract or add a second restore implementation.
- No new durable state, dependency, archive format, or deployment ordering.
- Run focused snapshot/reader/port suites and Cloudflare typecheck, inspect
  privacy and complexity, and commit the benchmark and supported optimization.
- Record benchmark results and rejected candidates in the benchmark owner doc.

## Progress

- Isolated task branch created from current main with the stall fix included.
- Benchmark runs through the actual port and verifies all restored file hashes.
- Copy-only decrypt experiment passed focused proof but showed no repeatable
  wall-time benefit under host contention; reverted it.
- Direct zstd-to-tar pipe removes the Node relay of expanded archive bytes,
  preserving both child exits, authentication, and failure cleanup.
- Omit account names from archive headers with numeric ownership metadata.
- Direct-pipe focused suites: 232 tests passed; Cloudflare typecheck passed.
- Pinned Linux image correctness smoke passed. Full-size Linux comparison was
  interrupted: AMD64 emulation, a 1.91 GiB Docker VM, and severe host contention
  made fixture setup and daemon operations impractically slow.
- Native same-object paired benchmark completed: seven measured pairs and one
  warmup each; all 1,000 restored file hashes passed in every restore.
  Median wall time 41.508 s -> 25.397 s, archive extraction 23.798 s -> 14.671 s,
  and Node CPU 2.808 s -> 2.238 s. Candidate faster in six of seven pairs.
- Host contention is material (load near 110 on 10 logical CPUs; about 18 GB
  swap). Local evidence supports the candidate but does not establish
  production absolute latency or a stable speedup percentage.
- Paced 10 MiB/s comparison completed: three measured pairs plus warmups,
  all hashes passed. Median wall time 16.127 s -> 12.449 s; extraction
  9.630 s -> 6.685 s. Candidate faster in all three pairs. All 24 full-size
  restores across both scenarios passed content verification.
- Complexity guard passed with zero hotspots above 20; changed-file privacy
  scan and whitespace checks passed. The documented source command passed
  a paired 1 MiB smoke with two measured iterations, including the corrected
  even-count median. Final typecheck and complexity guard passed.
- Parent review retained the direct pipe and rejected the copy-only change.
  Failure assertions allow a peer broken-pipe diagnostic while still requiring
  durable-state preservation and complete staging cleanup. Both early-exit
  cases passed again after the assertion refinement; typecheck passed again.
- Scope is a local benchmark and verified optimization candidate. No production
  deployment or PR completion claim; PR CI/final review belong to a later
  publication/release step. No member-facing changelog for this local experiment.
Updated: 2026-09-04
Completed: 2026-09-04
