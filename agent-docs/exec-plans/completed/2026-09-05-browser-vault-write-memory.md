# Reduce Browser Vault replica write memory

## Outcome and protected invariant

Reduce avoidable temporary memory during supported Browser Vault replica publication. Keep the complete existing root/shard/bucket read contract, encryption and AAD, namespace and write-fence authority, admission and orphan ownership, and publication only after successful durable writes.

## Evidence and owner

Bounded production metadata identifies repeated memory-limit failures during the existing replica write operation at R2 upload. Large replica writes currently retain the complete parsed payload, root serialization, all encoded shards and buckets, and concurrent encrypted envelopes. No private payload is needed for a synthetic reproduction. A stale large replica is a separate unresolved freshness signal; correlation remains to be proved.

The existing Cloudflare browser-vault store owns the correction. First evaluate deletion, ordering and shorter buffer lifetimes. No new protocol, state owner, scheduler, dependency, credential path, size-limit reduction or truncated product output is in scope.

## Product UX patch

Outcome: existing dashboard projections can become current after a successful refresh.
Reaches: members with large replicas, ordinary small replicas, and failed/denied publication paths.
Proof: synthetic complete-output decrypt/readback plus focused failure/authority tests and meaningful baseline/candidate memory evidence. No new UI or assistant behavior.

## Work and verification

- [x] Establish read-only symptom and compare current source and candidate owners.
- [x] Obtain ReviewGPT implementation and synthetic memory reproduction.
- [x] Inspect correctness, simplicity, privacy, runtime cost and compatibility.
- [x] Run focused tests, affected typecheck, complexity and documentation checks.
- [x] Commit and open one draft PR, then run final ReviewGPT concurrently with required CI on the stable pushed candidate.
- [x] Resolve final review with no accepted findings and preserve the functional fix for human merge.

## Authority and deployment

Production investigation is read-only. This functional fix is not authorized for merge or deployment. Preserve supported old/new readers and encrypted storage format; identify any additional compatibility requirement before accepting implementation. Do not replay work, send messages, mutate production data or configuration, or touch other owners' branches.

## Candidate proof and walkthrough

Product UX result: Ready for the bounded memory-cost improvement. Small existing replicas retain the same reference and complete encrypted output. A varied synthetic 28.05 MiB replica decrypts and exactly matches the complete root, all three fixed shards and all 32 metric buckets. Above-limit requests fail before admission or storage. Denied admission starts no PUT; child/root/multiple/undefined failures settle every planned write, return no successful reference, and keep deletion/publication admission until the final root settles. No audience, source-data policy, limit, format, crypto or reader changes.

The final candidate scopes parsed/split projections to child encoding, clears redundant maps, consumes child descriptors in the existing four-worker pool, and starts root encryption after all children settle. A first-error wrapper preserves even an undefined rejection. No new scheduler or state owner is introduced.

Pinned Node 24.14.1 verification: 315 tests across the store, large-store, limits, runner-outbound and crypto suites pass; Cloudflare typecheck passes; nine changelog archive cases pass. Complexity has no functions above 20 and store maximum falls from 13 to 9. Documentation drift, gardening, source hygiene and whitespace checks pass.

Separate fresh-process Node runs use the actual bounded JSON reader, store, public query parser/splitter and crypto owners with a disk-backed R2 substitute. At a 96 MiB old-space cap, the base aborts with native heap exhaustion; the candidate writes all 36 objects and subsequent complete decrypted readback passes. Old-space is only one part of process memory; this does not enforce the hosted isolate budget.

Local workerd with a real local R2 binding, identical 29,410,757-byte request, warmup and inspector sampling gives:

| Artificial delay per PUT | Base write ms | Candidate write ms | Base sampled JS heap bytes | Candidate sampled JS heap bytes |
| --- | ---: | ---: | ---: | ---: |
| 0 ms | 3866 | 2908 | 185578700 | 165033076 |
| 170 ms | 3484 | 4497 | 197828164 | 164064712 |
| 484 ms | 7118 | 7344 | 197815432 | 164046368 |

Base is 99024d9ac4cdbc583bf29f52a3fac00b6692dccf. These single-run injected-delay comparisons include automatic-GC variation, omit synchronous peaks, and do not establish live retained memory or compliance with the hosted 128 MiB limit. The original compatibility root/base64 allocations remain. The root barrier adds bounded latency; keeping child concurrency avoids the first candidate's unnecessary serial network cost. The existing refresh budget remains 30 seconds and can be shortened by a caller deadline.

To rerun the checked-in Node proof, bundle `apps/cloudflare/test/browser-vault-write-memory.proof.ts` with the existing Cloudflare esbuild dependency (Node platform, CJS format, Node 24 target, root tsconfig); invoke the bundle with `--browser-vault-memory-proof generate <temporary-directory>`, then `node --expose-gc --max-old-space-size=96 <bundle> --browser-vault-memory-proof write <temporary-directory>`, and finally its `read` mode in a separate unconstrained process. Fixture generation and complete readback run outside memory sampling. No production data or credentials are involved.

## Final review and completion

Final ReviewGPT round one passed on authored head `2a5b08e74b5e5fef30e0f0ec22d58a03b042dcba` on September 6. The managed Mountain lane completed the full snapshot audit after more than seven minutes. The captured response hash matches the separate concrete `gpt-6-pro` model evidence and the exact committed user/assistant turn linkage. The patch, snapshot inventory and first-reviewed baseline were validated. No qualifying findings remain.

The parent re-inspected the production diff, storage admission lifetime, complete-output proof and documented memory/latency limits. No further production change is justified. All four required checks passed on the reviewed head. This closing change only records review evidence and archives the plan; exact-head CI must also finish on that documentation-only closing commit. Existing focused behavior and memory proof remain applicable without rerunning unchanged tests.

PR #2966 remains open for human review and merge. No merge, deployment, production write or recovery was performed. Per-publication memory improves, but the remaining compatibility-root allocation and concurrent-publication exposure still require natural post-deploy observation after a separately authorized rollout. Unresolved production findings and diagnostic coverage belong in automation memory.
Status: completed
Updated: 2026-09-06
Completed: 2026-09-06
