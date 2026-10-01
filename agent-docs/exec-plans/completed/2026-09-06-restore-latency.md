# Reduce workspace restore latency without changing its integrity boundary

Status: completed
Created: 2026-09-06
Updated: 2026-09-06

## Goal

- Reduce cold workspace restore work with a small, measured change to the existing owner.

## Success criteria

- Paired synthetic restores preserve every file and demonstrate whether latency improves.
- Authentication, both digests, byte limits, failure recovery, and cancellation remain enforced before durable replacement.
- Focused tests and Cloudflare typecheck pass; discard unhelpful experiments.

## Scope

- In scope: existing download/decrypt/extract pipeline and independent preparation ordering.
- Out of scope: Rust, new dependencies or archive formats, production mutations, speculative extraction, new caches or workers.

## Constraints

- Keep full authentication before extraction and await owned work before cleanup.
- Do not duplicate ownership or weaken durable workspace recovery to improve a timing.
- Use synthetic fixtures only; report local benchmark limits explicitly.

## Risks and mitigations

1. Boundary-sensitive ciphertext splitting could mishandle the GCM tag.
   Mitigation: test arbitrary chunks, truncated/oversized streams, and tampering with preserved old roots.
2. Host contention can create apparent speedups.
   Mitigation: alternate paired revisions, verify byte readback, and report CPU alongside wall time.

## Tasks

1. Trace existing parallelism and redundant work; capture an unmodified benchmark module.
2. Benchmark a bounded experiment at the existing restore owner; retain only justified changes.
3. Run relevant correctness tests and typecheck; review the full diff and complexity.
4. Record measurement and shipping limits; close this plan and commit the scoped result.

## Decisions

- Heavy-runtime hydration already overlaps restore. Native zstd already pipes directly to native tar.
- Investigate eliminating ciphertext copies in the download loop using the ref's already-validated byte count; do not add concurrency unless an independent cost is demonstrated.
- Retained the bounded ciphertext/tag split: it removes two per-chunk copies with no concurrency and two fewer source lines overall. Existing restore and archive-format owners remain unchanged.
- No public changelog claim: this is an internal allocation reduction; a consistent production reply-latency improvement has not been established. The changelog skill's internal-refactor route applies.

## Product UX

- Outcome: reduce cold restore delay without changing restored content or recovery.
- Reaches: personal and group cold restores; warm reuse and reply content remain unchanged.
- Proof: real encrypted synthetic restores plus malformed-stream and interruption cases; no claim of measured production reply speedup.

## Verification

- Existing paired workspace-restore benchmark, with baseline bundled before edits.
- Focused snapshot-local, interruption, and runtime-platform tests; Cloudflare typecheck and complexity diff.
- Expected outcome: identical restored file hashes and preserved fail-closed behavior, with a candid before/after latency result.

## Results

- Seven paired Linux AMD64-emulated runs per fixture, two vCPUs and 6 GiB, preserved all 1,000 file hashes. Median restore wall time improved by 146 ms at 20 MiB and 292 ms at 50 MiB; Node CPU fell about 19% and 15%. Wall time improved in only four of seven pairs at each size. Full methods, paired differences, and limitations are in the existing benchmark owner.
- A consistent 300 ms production saving is not proven. No production mutation or deployment was performed, and no new snapshot format or concurrent work was introduced.
- `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --no-coverage apps/cloudflare/test/workspace-snapshot-local.test.ts apps/cloudflare/test/workspace-snapshot-interruption.test.ts apps/cloudflare/test/runner-platform.test.ts apps/cloudflare/test/hosted-response-body.test.ts`: 244 tests passed across four files.
- `pnpm --dir apps/cloudflare typecheck`: passed.
- `pnpm complexity:diff`: passed; maximum source complexity remains 16 with no hotspots above 20.
- Product UX walkthrough: Ready for the scoped internal optimization. Successful synthetic cold restores retain every byte; corrupted, interrupted, truncated, and oversized restores preserve the old root. Warm reuse, provider input, and delivery behavior are untouched. Production reply timing remains unmeasured.
- Parent review: same total-byte guard precedes consumption; no incoming view survives an await; the fixed tag buffer is zeroed in finally; authenticated extraction and old-root recovery remain with their existing owners. No new authority, network call, retry, process, or state owner.
- No PR, push, or deployment requested. Final external review and exact-head CI remain prerequisites for a later shipping lane.
Completed: 2026-09-06
