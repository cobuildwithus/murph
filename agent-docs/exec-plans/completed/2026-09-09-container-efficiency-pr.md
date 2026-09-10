# Prepare measured runtime efficiency improvements for merge

Status: completed
Created: 2026-09-09
Updated: 2026-09-09

## Goal

Reduce runtime CPU and memory work while preserving foreground priority, canonical
writes, query results, and authenticated snapshots. Prepare the measured candidate
as a reviewed PR with green required checks. Container sizing remains unchanged.

## Success criteria

- Retain only source optimizations supported by a concrete allocation or CPU cause
  and focused before/after evidence.
- Preserve canonical validation, correction/replay, durable progress after writes,
  cancellation before publication, and snapshot authentication.
- Run affected tests and typechecks; inspect complexity and the complete patch.
- Complete the required PR evidence, changelog, final ReviewGPT, exact-head CI,
  and current-base mergeability proof. Report a concrete blocker if any gate fails.

## Scope and owners

- Continue the existing container-efficiency branch and its measured optimizations.
- Query owner: avoid redundant work/materialization during projection rebuilds.
- Core owner: measure cooperative scan overhead and simplify only with proof.
- Cloudflare snapshot owner: attribute restore memory and remove proven overhead.
- Parent: integration, proof review, report updates, changelog, commits, PR and gates.
- Excluded: production secrets/data copies, production sizing/deployment, provider
  behavior changes, new persistent caches, and unrelated cleanup.

## Architecture and protected behavior

Reuse public ledger visitors, existing canonical mutation/lock boundaries, query
projection ownership, and authenticated archive pipelines. Canonical truth stays
in the vault; projections remain derived. Existing retry owners retain interrupted
background work. No new state owner, dependency, queue or runtime protocol is planned.
Serialized native Docker comparisons use synthetic data and exact process ownership.

## Product UX

Patch: an ordinary message can interrupt background import preparation while
completed writes remain durable. Query and automation results must remain identical
for sparse/history-heavy data, corrections, archived records, and retries. Restored
workspaces must match authenticated source contents. Proof targets these changed
boundaries; no claim of production end-to-end latency or 3 GiB fleet readiness.

## Risks and mitigations

- Cooperative yielding can trade throughput for responsiveness: report both.
- ARM-host AMD64 emulation and concurrent host load limit timing conclusions:
  alternate candidate/base runs and serialize heavy comparisons.
- Large archive peak includes fixture/page cache: attribute before optimizing.
- Main moved since the initial benchmarks: merge current base before edits and
  review overlapping runtime changes.
- Review and CI are separate gates; local tests do not establish merge readiness.

## Tasks

1. Reconcile current main and establish non-overlapping agent ownership.
2. Diagnose and implement the three bounded follow-up opportunities.
3. Run focused semantic and resource proof, reject unsupported candidates.
4. Review integrated changes; update maintained evidence and public changelog.
5. Commit, push and open a draft PR; mark ready only on the intended candidate.
6. Run final ReviewGPT concurrently with required CI, resolve findings within the
   repository completion policy, and prove mergeability.

## Decisions

- Current main merged cleanly before follow-up edits.
- One PR is preferred while changes share runtime evidence and remain reviewable;
  split only if an independent risky change would delay proven improvements.
- Historical completed plan and measurements remain immutable evidence.

## Verification

Prior candidate: focused core/importer/device-sync/query/assistant/archive tests,
typechecks and 104 successful constrained Docker checks; no OOM kills. The earlier
complexity guard reports five added branches, which must be inspected in this PR.
Follow-up commands/results, accepted changes, and final gates will be recorded here.

## Candidate evidence

- Retained: availability revision spines with irrelevant payloads discarded, and
  initialized-prefix clearing on failed encrypted restore. Existing ledger,
  snapshot pipe, query allocation and import-preemption improvements remain.
- Deferred: duplicate import preparation because repeated throughput comparisons
  were inconclusive; query visitor/hash and compression-thread candidates did not
  establish a safe improvement. Cache-admission and novelty derivation retain only
  behavior-preserving simplification. No container sizing or deployment changed.
- Final focused core import/session/preemption tests: 194 passed; core typecheck
  passed after deferring preparation changes. Availability: 13 passed plus 14
  baseline/candidate differential result/error/context-prompt comparisons matched.
- Snapshot: 37 passed and Cloudflare typecheck passed. Importer forwarding/alias
  cases: 45 passed. Service priority/retry: six passed. Changelog rendering: ten
  passed. Assistant-engine typecheck and deterministic context journey passed.
- Real Codex context journey: passed with one provider request, no actions or
  canonical writes. Three earlier subscription attempts failed before provider
  action; existing opaque authentication was used without copying material.
- `pnpm complexity:diff --base origin/main --json`: passed. Core mutation debt
  371 to 370, maximum 135 unchanged; no broader refactor justified.
- Resource measurements and limitations are maintained in
  `packages/core/bench/container-sizing.md`. All task benchmark containers removed;
  no OOM kills. Large restore fixture leaves insufficient evidence for production
  headroom with resident Codex children, so fleet downsizing remains unapproved.
- PR #3116 candidate `da1688134d` completed the full GPT-6 Pro review with PASS,
  no findings, verified exact turn/model/hash, and approximately 645 seconds to
  capture. Three user-requested foreground context, foreground-over-sync and
  snapshot/query audits completed with no introduced defect; each identified a
  direct latency-evidence gap, not a code finding. Production downsizing and a
  zero-added-tail-latency claim remain unsupported.
- Initial PR CI: native 1-vCPU / 6-GiB runner comparison, all release test/coverage
  shards, Cloudflare, hosted Web, host matrix, billing and foreground cardinality
  passed. Build/typecheck's logging guard flagged only the benchmark's inline
  prompt hash; all typechecks themselves passed. Hoisting that digest outside the
  log call changes no output, measurement or production source. Guard/typecheck
  and one additional 1-vCPU / 3-GiB six-phase context proof pass after correction;
  that container exited without OOM and was removed.
- Parent triage found no accepted review findings and no justified production
  remediation. The final follow-up is limited to benchmark logging and explanatory
  evidence/plan closure, which use the review loop's non-runtime exemption.
- Final exact-head CI and current-base mergeability remain the PR handoff gates;
  results will be recorded in the PR after this completion commit. No merge or
  production deployment is part of this task.
Completed: 2026-09-09
