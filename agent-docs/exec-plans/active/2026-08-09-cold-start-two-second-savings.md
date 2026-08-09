# Reduce hosted cold-start provider latency toward two seconds

Status: active
Created: 2026-08-09
Updated: 2026-08-09

## Goal

- Remove at least 1 second from the established-member hosted cold path between
  accepted inbound and upstream provider start if production scheduling realizes
  the reordered overlap, while pursuing the preferred 2-second target without
  weakening durable ingress, consent, single-turn authority, or reply delivery.

## Success criteria

- The existing platform start command moves across both the Temporal handoff and
  the UserRunner preparation interval on the observed production critical path,
  with a post-deploy cold trace required to establish whether the realized saving
  reaches 1 second.
- Production timing evidence is decomposed far enough to prove that the changed
  work is on the measured critical path; speculative work with no demonstrated
  latency benefit is not shipped.
- The solution adds no keepalive service, second state owner, durable queue, or
  provider/thread authority before the existing admitted turn.
- Focused tests and typechecks pass, required GitHub Actions pass on the exact PR
  head, and both required ReviewGPT stages return no unresolved findings.

## Scope

- In scope: established-member direct wake, container readiness, hosted workspace
  restore, mailbox-to-assistant handoff, Codex process preparation, provider plan
  construction, and focused latency instrumentation or benchmark coverage.
- Out of scope: changing model behavior, reducing safety or consent checks,
  weakening durable ingress, extending warm leases, or adding speculative
  infrastructure without measured proof.

## Constraints

- Technical constraints: preserve Temporal acceptance before authoritative direct
  ensure, one warm app-server process per runtime, process-only speculative prep,
  crash-safe mailbox recovery, and the hosted workspace continuity contract.
- Product/process constraints: prefer deletion, reordering, and overlap over new
  state; keep private production evidence out of repository artifacts; follow the
  high-risk Cloudflare/runtime PR lane and deployment-skew review.

## Risks and mitigations

1. Risk: moving work earlier grants provider or turn authority before admission.
   Mitigation: permit only idempotent process/shell preparation before the current
   admission boundary, and prove cancellation and ownership behavior in tests.
2. Risk: removing or deferring filesystem work breaks crash recovery or context.
   Mitigation: trace each read to its invariant and retain the smallest owning
   evidence path, with regression tests for replay and cross-session behavior.
3. Risk: a local benchmark overstates savings that are dominated by the platform.
   Mitigation: separate platform, restore, runtime, and provider-start stages and
   compare like-for-like runs; use production aggregates only as private evidence.
4. Risk: Cloudflare and web deployments temporarily disagree on a control route.
   Mitigation: prefer compatibility-preserving changes and document any required
   tandem order plus a post-deploy binding check.

## Tasks

1. Decompose the observed cold trace against current timing fields and code owners.
2. Ask ReviewGPT for an independent deletion/overlap proposal against the exact
   candidate files and reconcile it with repository invariants.
3. Benchmark the strongest candidates, rejecting changes that cannot plausibly
   contribute to the 2-second goal.
4. Implement the smallest proven change with focused regression and latency proof.
5. Run scoped verification, inspect the privacy-safe diff, commit, push, open the
   PR, and complete the preliminary specialist plus final ReviewGPT/CI gates.

## Decisions

- The existing Codex app-server speculative preinitialization already won on the
  observed cold trace: spawn readiness cost about 1 ms. Do not add another app
  server or broaden its authority; investigate the remaining turn-start work.
- Mailbox decode-to-stage measured only tens of milliseconds on the observed
  trace, so moving the existing post-stage preparation callback alone cannot meet
  the goal.
- ReviewGPT identified the existing owner-neutral shell-prewarm RPC as the only
  safe scheduling seam and rejected speculative restore and provider shortcuts.
  A Cloudflare-local composition exposed only the route-to-UserRunner interval,
  measured at a few hundred milliseconds locally, so it was deleted rather than
  kept as a redundant second prewarm owner.
- Established Linq ingress now reuses the existing shell-prewarm request at the
  earliest already-proved access boundary, before the Temporal network hop. The
  durable signal and post-accept direct ensure remain authoritative; access
  denial starts no container, and a Temporal failure can leave only an idle shell.
- Three synthetic cold-start cohorts showed substantial host-level variance, so
  their raw end-to-end medians do not prove a realized saving. The added benchmark
  spans preserve the measurement gate, and the candidate must be judged by a
  comparable post-deploy cold trace rather than a normalized or cherry-picked
  local result.

## Verification

- Commands to run: focused package tests and typechecks selected from the final
  diff, the hosted cold-start benchmark or deterministic critical-path proof,
  repository diff/privacy inspection, exact-head GitHub Actions, preliminary
  completion-specialists ReviewGPT, and final full-patch ReviewGPT.
- Expected outcomes: the platform start command is structurally issued before
  Temporal instead of after UserRunner preparation, the post-deploy trace reports
  the realized saving, no behavioral regression or identifier leakage is present,
  checks are green, and no review finding remains unresolved.
