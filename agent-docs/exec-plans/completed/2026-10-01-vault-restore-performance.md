# Reduce authenticated workspace restore cost

Status: completed
Created: 2026-10-01
Updated: 2026-10-01

## Outcome and invariants

Reduce measured workspace download, authentication, or extraction work using the existing snapshot owner. Preserve GCM authentication, reference digests, atomic replacement, subsecond mtimes, cancellation, bounded memory, and current snapshot compatibility.

## Evidence and scope

The previous uniform synthetic fixture did not establish a useful extraction optimization. Use a locally authorized private archive only in isolated temporary storage, with neutral filenames and aggregate output; never include its bytes or paths in prompts, repository artifacts, or review packets. Publish synthetic verification only.

## Approach

1. Consult Claude with source and public-safe measurements; benchmark realistic file size and compression distributions.
2. Measure archive compression choices and restore data copying before adding any mechanism. Prefer deletion or changes to existing constants; no new services, caches, dependencies, or persisted state.
3. Retain only an improvement with paired measurements and complete restored-content verification.
4. Run focused failure-path tests, affected typecheck, complexity guard, and parent review.
5. Open a scoped draft PR, complete final ReviewGPT and exact-head CI, and report the measured result and limits.

## Failure and delivery

Keep the existing single-object format and reader compatibility. Authentication, corruption, interruption, and child-process failures must not replace the durable workspace. Avoid transferring checkpoint work onto a foreground reply.

## Verification

Use the real producer/restore owners, alternating paired runs, untimed file hash readback, and independent synthetic cases. Keep production improvement claims separate from local proof. Internal runtime performance only: no changelog unless user-visible behavior changes beyond timing.

## Candidate decision

- Retain only zstd creation level 3 to 9, using the existing two compression workers. No restore logic, schema, package, service, configuration surface, or state owner is added.
- The locally authorized workload produced 5.6% fewer encrypted bytes. The final seven-pair native ARM Linux run at 48 MiB/s pacing reduced median restore wall time from 621 ms to 603 ms; all seven pairs improved, with a 7 ms median paired difference. An unpaced seven-pair run reduced medians from 363 ms to 343 ms, with five of seven pairs improving. All restored files passed SHA-256 readback.
- This trades approximately 280–300 ms of additional idle-checkpoint wall time and about 64 MiB additional compressor peak RSS for fewer foreground transfer bytes. It is workload-dependent and is not a production cold-start speedup claim.
- Reject the larger compression window, tar-owned decompression, native streaming decompression, larger tar records, and response-reader changes. They were slower, did not establish a material gain, or broadened behavior for negligible benefit.
- Preserve per-shard ledger archiving: it reduces uncompressed storage/extraction work even when separate compression makes the outer compressed archive slightly larger. Replace that fixture's invalid encrypted-size monotonicity assertion with complete historical-event content readback.

## Product UX patch

- Outcome: reduce the bytes a cold workspace must download and authenticate.
- Reaches: snapshots produced by future ordinary idle checkpoints; current readers continue accepting existing snapshots.
- Proof: actual producer/restore round trips, full file readback, failure-path tests, and paired timing. No prompt, tools, channel actions, or provider-visible input changes.
- Result: Ready for candidate review; overall staging latency remains an open performance question.

## Completion gates

Focused checks, parent review, PR, final ReviewGPT, and exact-head CI are tracked by this task. Private inputs and expanded data are excluded from all committed and review artifacts.

## Local verification

- Cloudflare dependency and owner build: passed.
- Focused snapshot local, interruption, and process-diagnostics tests: 52 passed.
- Cloudflare typecheck: passed after generating the existing local Prisma client; no database operation was performed.
- Complexity diff: passed; maximum complexity remains 16, no function exceeds 20, and no production branches were added.
- Parent candidate review: checked authentication-before-extraction, old/new reader compatibility, idle-only cost placement, test meaning, privacy, and complete diff. No new Frog entry: the only setup issue reused the known missing generated Prisma client case.

## Delivery and remaining limits

- PR #3945 contains the one-constant production change, stronger content readback, and storage-contract explanation. Claude Opus 5.5 was consulted on compression, streaming, and extraction options; unhelpful experiments were discarded.
- Final ReviewGPT round 1 passed on `fb5590a0b8f44f4c763e44fb71aae9eade48e7cc`, with zero findings. The captured response and committed-turn identity were verified. The guarded full snapshot, selected Hercules/6Pro lane, completed response after more than ten minutes, exact head, substantive path audit, and reported 17 independent direct-source checks support acceptance. The reviewer did not independently run the repository suites or verify production performance.
- Parent final review confirms the production delta remains one constant; no restore, cancellation, authentication, digest, state, or API contract changes. Plan closeout changes explanatory documentation only and needs no new substantive review round.
- Exact-head CI is tracked on the PR; final commit checks must pass before merge readiness. No deployment or merge is part of this PR handoff.
- Task-owned private extraction and benchmark archives were deleted after measurements. The supplied original archive was preserved. No private content was submitted to either reviewer or included in the PR.
- Production extraction latency remains unexplained by these local measurements. This bounded improvement reduces measured snapshot size; it does not claim to solve the complete staging interval.
Completed: 2026-10-01
