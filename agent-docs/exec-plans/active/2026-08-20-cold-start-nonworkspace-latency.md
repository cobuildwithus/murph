# Hosted cold-start non-workspace latency

Status: active
Updated: 2026-08-20

## Goal

Reduce established-member cold-start latency by at least 500 ms, ideally one
second, without changing typing-hint behavior or workspace archive size and
without weakening foreground reply correctness, authority, or recovery.

Success means:

- a production-shaped benchmark shows a repeatable improvement of at least
  500 ms through the first real invocation, not merely an earlier health
  response;
- the ordinary post-Temporal direct ensure continues to overlap container boot
  with invocation preparation;
- foreground readiness remains higher priority than maintenance, cleanup, and
  optional diagnostics;
- no queue, scheduler, cache owner, persisted state, compatibility layer, or
  dependency is added; and
- focused tests, owner typechecks, Docker proof, and the requested ReviewGPT
  review pass before any candidate is proposed for publication.

## Current evidence

- The affected cold request reached the runner in about 7.8 seconds, reached
  provider start in about 14.5 seconds, and reached accepted reply in about
  20.6 seconds.
- Container readiness took about 6.5 seconds, including about 4.8 seconds of
  Node startup.
- The post-restore to provider-start interval was about 3.6 seconds and is close
  to the recent fleet median, so any correction here should be a generally
  useful hot-path simplification rather than member-specific handling.
- Across 24 recent causally matched cold starts, container-ready to runner-job
  accepted measured 55 ms at p50 and 267 ms at p95. Deferring the invocation
  import until after health therefore cannot hide enough work to meet the goal.
- The affected post-restore path included about 0.79 seconds before the
  assistant phase, 0.49 seconds of workspace assistant pre-automation work,
  0.23 seconds in the automation lane, 0.37 seconds in provider planning and
  authority, and 0.61 seconds after App Server handoff before the upstream
  provider began.
- Fleet medians are materially lower for several of those leaves: 272 ms before
  the assistant phase, 36 ms of workspace pre-automation work, 387 ms in the
  automation lane, 218 ms in provider planning and authority, and 34 ms after
  App Server handoff. Optimize shared ownership or repeated work, not one
  member-specific delay.
- Cold App Server initialization is already speculatively overlapped from the
  conversation-staged callback. The affected trace showed warm process reuse,
  so adding a second prewarm owner would add complexity without addressing the
  observed delay.
- Workspace restore size and typing-hint delivery are explicitly out of scope.
- Existing active plans already own receipt-scan concurrency and R2 restore
  timing. This task will not duplicate those changes.

## Architecture and invariants

- Cloudflare remains the execution adapter; Web and Temporal retain their
  current control and durable orchestration ownership.
- Accepted work remains sufficient admission authority for model start.
- Wrong-user authority, stale fences, invalidated shells, consent withdrawal,
  and exact-target destruction remain fail closed.
- Observability remains metadata-only and cannot add awaited foreground work.
- Prefer deletion or reordering of existing work over a new abstraction.

## Approach

1. Reproduce the non-workspace cold path in the hosted-local Docker harness and
   record a baseline through the first invocation.
2. Package the sanitized production evidence, current contracts, relevant code,
   and local baseline for a ReviewGPT architecture/performance attack pass.
3. Prove one concrete avoidable boundary with code-path evidence and a focused
   failing regression or benchmark assertion.
4. Apply the smallest maintainable deletion or reordering that preserves the
   existing owners and failure semantics. Reject health-only code motion.
5. Re-run the same Docker benchmark, focused tests, owner typechecks, privacy
   checks, and diff inspection.
6. If a candidate clears the measurement gate, request publication authority
   and then complete the repository's exact-head review and CI gates.

## Rejected experiment

- Splitting the container supervisor from the invocation graph reduced the
  health-time static closure from about 8.44 MB to 1.95 MB and made `/health`
  arrive much earlier.
- A same-image Docker check through an actual invocation falsified the apparent
  win: the baseline POST failed after about 1.1 seconds, while the deferred
  candidate's POST spent about 157.7 seconds loading under amd64-on-ARM
  emulation. The absolute values are not production-representative, but the
  movement of work from health into invocation is unambiguous and agrees with
  the production overlap window.
- The experiment was fully reverted; no code or test changes from it remain.
- The full hosted-local stack cannot run on this ARM host because the pinned
  amd64 proxy image exits under emulation. Direct runner-container Docker proof
  and production phase telemetry are the available local/production-shaped
  checks.
- The supplied vault export validates cleanly, but it intentionally excludes
  hosted runtime state, so it cannot reproduce the post-import selection and
  provider-start path. The isolated extracted copy was moved to Trash after
  inspection; the original archive was not modified.

## Review and current implementation

- ReviewGPT reviewed the full repository archive, the production phase
  aggregates, and the Docker falsification. Its architecture verdict was that
  no correctness-preserving in-scope code change credibly removes 500 ms from
  the first real invocation.
- A follow-up review corrected an initial telemetry suggestion: the automation
  lane already has ten additive leaves. The remaining opaque interval is
  `mailboxImportDoneToAssistantPhaseMs`, which is 272 ms at fleet p50, 1,201 ms
  at fleet p95, and 786 ms on the affected trace.
- The local candidate therefore changes timing only. It partitions that
  existing interval into four adjacent leaves: coordinator setup before the
  foreground pass, foreground-to-workspace pass handoff, workspace pass to the
  assistant callback, and callback preparation to assistant-phase entry.
- The new leaves use the existing immutable provider-start context and existing
  provider-start trace request. They add no request, await, lifecycle owner,
  persisted state, or execution-order change. Partial or non-additive telemetry
  is discarded while the canonical timing remains available.

## Verification

- Focused provider timing, runtime-control parser, maintenance, and workspace
  entrypoint tests pass: 4 files and 462 tests.
- The assistant engine, hosted execution, and assistant runtime owner
  typechecks pass.
- Clean builds for those owners pass, followed by the production runner-bundle
  build across the full dependency graph. The runner entrypoint and static boot
  closure remain inside their size budgets.
- The production amd64 Docker image builds successfully on this ARM host. The
  repository's networkless Docker smoke reaches the Codex App Server probe but
  its `vault-cli --llms` command exceeds the fixed timeout under emulation. The
  timeout exits with code 124 and no application stderr, so it is recorded as
  an architecture-emulation limitation rather than a product pass.
- No latency improvement is claimed. The measurement candidate exists only to
  identify whether a later deletion or overlap can meet the 500 ms gate.

## Publication decision

- The original optimization gate remains unmet: no clean in-scope change
  demonstrated a 500 ms first-invocation improvement.
- After reviewing that result, the user explicitly authorized publishing the
  diagnostic-only candidate in a PR so exact-head CI and review can validate
  the new timing partition and future traces can identify a removable owner.
- This exception authorizes the telemetry candidate only. It does not turn the
  instrumentation into a latency claim or authorize the rejected health-only
  experiment.

## Stop conditions

- Do not ship a latency-improvement claim below 500 ms or any gain that depends
  on weakening a correctness or authority gate. The explicitly authorized
  diagnostic-only PR above remains permitted without such a claim.
- If the remaining latency is entirely platform boot, provider wait, workspace
  restore, typing delivery, or already-owned receipt work, preserve the evidence
  and report that no maintainable in-scope fix met the threshold.
