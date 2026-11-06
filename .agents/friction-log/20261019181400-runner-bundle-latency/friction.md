---
title: 'Runner bundle latency CI cancels during native Codex compilation before samples'
severity: 'minor'
---

## Expected Behavior

The production runner bundle budget job should finish the native source build within its explicit build budget, then measure the candidate and baseline under the unchanged one-vCPU latency limits, or report a concrete build failure.

## Current Behavior

Host Support run 39328838919, attempt 1, canceled the latency step during Codex 0.163.0 source compilation before any sample. The step ran for about 20 minutes, below its 195-minute limit and the 90-minute build timeout. The sole annotation reports cancellation without a cause. Attempt 2 reached the final crates, then logged `Killed` and exit 137 after about 16 minutes. Attempt 3 enabled runner diagnostics, but the hosted runner lost communication and never uploaded its job or diagnostic logs. These establish execution failures, not their underlying cause. The same cancellation symptom occurred in run 39184625416, while the intervening run 39189084341 passed in about 34 minutes. Resource exhaustion remains a hypothesis, not established evidence.

The budget job now uses the existing two-job native compilation setting already proven by the current candidate's permission-sandbox run 39328838880. This is a bounded build-resource mitigation for the heavier two-checkout job. It changes neither the image source fingerprint nor the one-vCPU measurements, timeouts, or assertions. Host Support run 39345224818 on PR head d8d1d500 subsequently passed: its native build completed with two jobs, the latency step took 46 minutes, and all six CPU/wall comparisons passed the unchanged budgets. This verifies the mitigation can complete; it is not a claim that an OOM cause was proved.

## Minimal Reproducible Example

Run the existing Host Support production runner bundle budget job for the reviewed Codex 0.163.0 upgrade while its native base image is unpublished. Inspect the source-build phase and whether the job reaches its latency samples. The cancellation is intermittent; the exact trigger remains unknown.

## Context

These failures blocked exact-head upgrade verification and consumed a fresh native build on each retry; the bounded mitigation now has a passing candidate receipt. Preserve the failed attempts and distinguish the bounded compilation mitigation from an established root cause. Never increase the benchmark limits to accommodate a build failure.

## Native build reuse follow-up

A later Node-only security refresh exposed two deterministic reuse gaps: the
public image publisher did not export intermediate BuildKit cache, and native
helper extraction inherited the runtime Node base. The follow-up separates the
checksum-pinned helper archive from Node and exports a protected-main registry
cache for read-only reuse. The existing permission workflow now requires the
Cargo build vertex to remain cached after changing runtime-only Node pins. This
addresses repeated compilation without changing Cargo concurrency, sandbox
assertions, or benchmark limits; cache-hit timing remains an actual CI receipt.
