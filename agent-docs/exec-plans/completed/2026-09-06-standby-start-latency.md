# Reduce fresh hosted standby handoff latency

Status: completed
Created: 2026-09-06
Updated: 2026-09-06

## Goal

Reduce first-turn setup after an admitted request claims a pristine runner, using existing owners and synthetic local latency proof.

## Product UX

Effort: Patch.
Outcome: Reduce setup before a fresh hosted runtime can process a message.
Reaches: Admitted fresh starts, including standby claim and cold fallback; active warm wakes retain their existing path.
Proof: Composed controller/service tests plus failure, deadline, member isolation, lifecycle and authenticated restore checks. Local timing only; production delivery timing remains unmeasured for this candidate.

## Success criteria

- Reproduce avoidable serial waits with controlled delays through the actual controller and invocation service.
- Remove measured waits without bypassing consent, member identity, immutable slot binding, exact write fences, encryption, or checkpoint CAS.
- Preserve allocation failure recovery and bound abandoned preparation reads.
- Pass focused tests, Cloudflare typecheck, owner documentation and complexity checks; record the limits of local evidence.

## Scope

Investigate coordinator dispatch, claim/bind, invocation preparation and snapshot restore. Implement only changes supported by code-path and local benchmark evidence. Production deployment is outside this local optimization task.

## Constraints

Use synthetic inputs and no production credentials or private snapshots. Preserve existing active work and the separately owned query-projection snapshot PR. Do not change pool size, placement, admission policy or typing semantics to disguise execution latency.

## Findings and decisions

- Fresh allocation currently completes before workspace metadata and runtime crypto reads begin; the latter reads also run serially. They are read-only inputs whose authority remains enforced by the current admission and fenced invocation owners.
- Standby readiness already checks heavy runtime hydration. Snapshot restore already overlaps network reads with decryption and uses a direct native decompressor-to-tar pipe; nested timing spans must not be added as independent waits.
- The platform dispatch gap cannot be assigned to application CPU or geography from existing local evidence. Do not promise a local reduction of platform cold-start latency.

## Tasks

1. Establish focused baseline and synthetic delayed-I/O reproduction.
2. Overlap admitted fresh allocation with bounded read-only invocation inputs; retain exact fenced consumption and failure handling.
3. Benchmark restore and inspect claim boundaries; overlap independent fenced binding verification with runner-secret and restore preparation.
4. Run focused failure/concurrency tests, typecheck, documentation and complexity checks; review and commit the scoped result.

## Risks and mitigations

- Early reads could outlive allocation failure: use existing per-request deadlines and observe rejection; no execution, binding or provider effect is authorized by a prepared read.
- Prepared inputs must not cross member/request boundaries: validate workspace and crypto-store membership and keep prepared inputs behind a private invocation-local closure.
- Local timings exclude distributed network and storage replication: report controlled critical-path savings separately from production expectations.

## Verification

- Six focused suites passed: 196 tests across hosted runner identity, runner fleet lifecycle, standby runner, snapshot restore preparation, snapshot local restore, and snapshot interruption.
- Cloudflare typecheck passed. The existing Cloudflare build passed before implementation; the final candidate is checked through the package typecheck and actual source-based runtime tests.
- Docs drift and `git diff --check` passed.
- Complexity guard passed: invocation-file complexity debt 9 -> 7 and maximum 25 -> 24; controller debt and maximum unchanged. Remaining hotspots are existing provider/preparation and lifecycle branches; no further unrelated refactor was justified.
- Parent review covered allocation/reservation/fence ordering, immutable member binding, post-read budget checks, unused promise rejection, retained failed-allocation targets, launch attribution, privacy and call-count changes.
- Product UX: Ready for local integration. Fresh claim, cold fallback, warm reuse and failure recovery retain existing authorities. No public deployment or live messaging proof is claimed.
- Final integration still needs its source PR, eligible member-facing changelog, required hosted checks/review and deployment measurements. This task closes at the locally verified commit boundary.

## Local investigation evidence

- The original controlled allocation fixture measured 733.48 ms at the base and 331.34 ms after parallel metadata/crypto loading. The baseline failed the causal overlap assertions, while the candidate passed.
- A second independent serial wait was found in fenced preparation: immutable binding verification waited for runner-secret and snapshot-restore preparation despite independent inputs. It now joins their existing parallel read group. Provider credentials are still minted only after verified binding.
- The unchanged production restore port restored a synthetic 52,532,731-byte encrypted object into 131,073,000 bytes across 1,000 files. Three measured restores after warmup took 1,372.14 / 1,087.85 / 983.15 ms (median 1,087.85 ms). Every file passed hash readback. This used real loopback HTTP, AES-GCM, digest checks, native zstd/tar and directory replacement; it excludes production network placement, provider execution and container startup.
- Restore already authenticates before extraction and uses a native pipe. No additional restore modification was justified by these measurements. Snapshot-content reduction is separately owned and excluded here.
- Coordinator claim/bind involves distributed Durable Objects and durable storage; local delayed-I/O proof models those waits but cannot establish a production placement or replication fix. No pool, location or admission configuration was changed.
- Foreground calls: workspace-control read and runtime crypto/cache lookup move earlier and run concurrently (one existing call each, existing cache behavior and timeout budget). Binding verification moves into the existing secret/restore preparation group (one existing RPC, same remaining budget). No new provider request, retry, durable state owner, wire shape or cache was added. A failed allocation can now leave two bounded read-only inputs unused; it cannot launch a runtime.
- Changelog: prepare a member-facing performance entry at PR integration, once the source PR exists; this local branch is not shipped and no public release claim is published.

## Final paired setup measurement

The final fixture uses 100 ms claim, 100 ms bind, 200 ms workspace metadata,
300 ms crypto lookup, 100 ms runner-secret read and 100 ms immutable-binding
read. It exercises the actual controller, invocation service and state store;
provider execution is replaced only at the invocation acceptance boundary.
Against base `17e848a498ae6c4bb32d803ca860c23f1f7d8c20` the fixture took
951.19 ms; the final candidate took 434.26 ms (516.93 ms saved, 54.3%).
The base failed both causal overlap assertions, including binding verification
while secrets were blocked; the candidate passed both. Launch attribution and
allocation/preparation timing fields survived the early-read handoff.
This is controlled delayed-I/O evidence, not an end-to-end production forecast.
Completed: 2026-09-06
