# Cloudflare Checkpoint CPU Reduction

Status: completed
Created: 2026-07-16
Updated: 2026-07-16

## Goal

- Reduce the CPU and memory cost of hosted workspace checkpoint and restore work without adding foreground user latency or weakening snapshot integrity, interruptibility, encryption, or workspace-version fencing.
- Diagnose concentrated high-CPU runner instances with production-faithful Docker measurements and land the smallest maintainable fix set that the evidence supports.

## Success criteria

- A private production vault can be exercised through the production runner image without copying its contents into the repository or emitting file names, paths, or payloads.
- Baseline and changed runs report aggregate wall time, CPU time, peak cgroup memory, archive bytes, and file counts for the same workload.
- Each production-code optimization removes demonstrated duplicate work or an avoidable allocation and has focused correctness/failure coverage.
- Foreground-priority, abort, archive-integrity, encryption, and workspace-CAS invariants remain intact.
- Required Cloudflare verification, production-image proof, completion audits, CI, and ReviewGPT reach a clean result before merge.

## Scope

- In scope:
  - `apps/cloudflare` local v2 snapshot writer/restore implementation and focused tests.
  - Existing runner Docker bundle/image tooling needed for production-faithful proof.
  - Directly affected snapshot protocol and verification documentation.
  - One cohesive PR by default; split only if the evidence yields independently deployable fixes with materially different risk.
- Out of scope:
  - Reducing the production container size before post-change telemetry proves `basic` headroom.
  - Shortening the warm container TTL under the zero-added-latency constraint.
  - New queues, services, persisted state, cache managers, or profiler subsystems.
  - Unrelated browser-vault, Codex transcript, or hosted orchestration refactors.

## Constraints

- Technical constraints:
  - Preserve authenticate-before-extract, symlink/path safety, snapshot bounds, canonical-write locking, and pre-publication abort behavior.
  - Keep the snapshot body on the direct container-to-R2 path; do not move it through the Worker.
  - Benchmark the exact production app-layer image on a constrained Linux container; local ARM64 emulation limitations must be reported rather than hidden.
- Product/process constraints:
  - Foreground input must not wait for checkpoint or maintenance work.
  - The private vault is read-only test input and must never enter Git, logs, docs, fixtures, uploaded artifacts, PR text, or review packets.
  - Favor deletion and single-pass data flow over new abstractions.

## Risks and mitigations

1. Risk: Removing validation work could accept an unsafe or incomplete archive.
   Mitigation: Map each current validation to its owning invariant, retain independent proof where required, and add corruption/race tests before deleting a pass.
2. Risk: A faster wall-clock result could use the same or more billed CPU.
   Mitigation: Measure CPU-seconds and throttling alongside elapsed time and memory peak.
3. Risk: Docker Desktop architecture emulation could distort production sizing conclusions.
   Mitigation: use relative before/after comparisons on the same image and configuration, record the architecture gap, and rely on native CI for final AMD64 image proof.
4. Risk: Test instrumentation could become production complexity.
   Mitigation: keep one-off private benchmarks outside Git and add only reusable aggregate observability when it directly closes a production decision gap.

## Tasks

1. Map snapshot/checkpoint invariants and reproduce current CPU/memory behavior in the production runner image.
2. Attribute duplicate work by phase and verify whether concentrated CPU aligns with snapshot size/file count or another runtime phase.
3. Select the smallest high-value fixes supported by repeatable evidence.
4. Implement focused fixes and regression tests.
5. Re-run identical Docker measurements, full required verification, coverage-write, CI, and ReviewGPT.
6. Commit, push, open the PR, resolve findings, and merge when all required gates are green.

## Decisions

- Default to one cohesive checkpoint/restore PR; do not manufacture multiple PRs without an independent deployment or review boundary.
- Do not lower container resources in this task. The result should create evidence and headroom for a later canary.
- Use the private production vault only for local aggregate benchmark evidence; committed tests use synthetic fixtures.
- Keep the existing two-thread zstd setting. A separate six-pair one-thread experiment was noisy, with effectively flat median wall time and no repeatable advantage large enough to justify another behavior change.
- Replace the post-write decrypt/decompress/tar-list pass with validation of the original tar process's verbose manifest plus a byte-for-byte encrypted-file digest check. This preserves plan, archive, and exact-upload-object proof without a second archive traversal.
- Cache each selected path's `lstat` result only within one preflight pass. The canonical workspace write lock remains the concurrency owner, while the post-archive pass starts with a fresh cache and retains the existing unchanged-state comparison.

## Evidence

- The production runner base image was exercised as Linux AMD64 with one CPU, 3 GiB memory, no network, and read-only private-vault input. Only aggregate measurements were emitted; the workload contents and paths stayed outside the repository and review artifacts.
- Across six paired before/after runs on the same representative workload, median checkpoint-build CPU fell 63.3%, checkpoint-build wall time fell 66.6%, and end-to-end snapshot/restore CPU fell 51.6%. Peak memory was effectively flat and slightly lower in the paired median.
- A separate six-pair isolation run showed that eliminating repeated ancestor metadata reads accounted for the dominant improvement: median checkpoint-build CPU fell 69.6% and wall time fell 73.0% relative to the otherwise identical single-pass implementation.

## Verification

- Focused snapshot writer/restore tests, including abort and corruption cases.
- `pnpm test:diff <changed paths>` during iteration.
- `pnpm verify:acceptance` for the final high-risk Cloudflare runtime patch.
- Production runner image build and identical before/after checkpoint/restore benchmark under explicit CPU/memory limits.
- `pnpm --dir apps/cloudflare runner:docker:smoke:prepared-base` or the strongest applicable production-image smoke supported by the local architecture.
- Required `coverage-write` audit, privacy/diff review, CI, and ReviewGPT on the exact pushed PR head.

## Local completion results

- Focused snapshot coverage passed with 17 tests, including emitted-manifest divergence, redundant-process deletion, abort cleanup, and encrypted-file digest mismatch cleanup.
- The required `coverage-write` audit added only the encrypted-file digest mismatch proof and returned with no unresolved findings.
- Cloudflare typecheck passed during the scoped diff lane. The wider app test bucket did not complete locally: default-parallel, serial, and single-worker attempts each stalled in unrelated package-build subprocess I/O under shared-host contention after the changed focused suite had passed.
- The production runner bundle and AMD64 application image built successfully. The local container smoke reached the Codex permission probe, then stopped because Docker Desktop's emulated Linux kernel returned `ENOSYS` while Codex installed its nested seccomp filter; native Linux CI remains the authoritative smoke lane.
- `pnpm verify:acceptance` could not start because an unrelated verification process held the single shared-host slot while idle for more than 22 minutes. The queued waiter was cancelled without signaling the unowned slot holder.
- `git diff --check` passed. PR CI and ReviewGPT remain the post-push merge-readiness gates.
Completed: 2026-07-16
