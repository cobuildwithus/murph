# Use the static SSH worker's 10 cores efficiently

Status: active
Created: 2026-07-28
Updated: 2026-07-28

## Goal

- Reduce production-faithful static SSH acceptance wall time on the dedicated
  10-core, 32 GiB macOS worker by using its available CPU concurrently.
- Preserve the existing secret-free candidate boundary, executor-owned
  scheduling, one-job native lock, exact cleanup, and fail-closed behavior.

## Success criteria

- The `static-ssh` profile derives a bounded 10-core schedule that overlaps
  independent package, app, and fixture work without caller tuning.
- Peak scheduled Vitest work stays within the worker CPU budget and leaves
  explicit capacity for coordinator, build, lint, and smoke processes.
- Focused scheduler tests prove the 10-core resource plan, smaller-host
  fallback, caller-override rejection, phase release ordering, and failure
  propagation.
- Canonical verification passes, preliminary and final ReviewGPT return no
  unresolved accepted findings, and the production-faithful SSH benchmark
  improves on the existing 13m18s end-to-end baseline.

## Scope

- In scope: `scripts/workspace-verify.sh`, its repo-tool tests, current
  verification/security/reliability/testing docs, and direct static-worker
  benchmark evidence.
- Out of scope: SSH routing, account provisioning, Crabbox transport and sync,
  the native worker lock, persistent worker services, paid Blacksmith
  verification, and application/runtime behavior.

## Constraints

- Technical constraints: no daemon, queue, coordinator, persisted scheduler
  state, caller-selected static profile tuning, secret forwarding, or machine
  identifier in repository artifacts.
- Product/process constraints: use the isolated worktree/PR lane, preserve
  unrelated work, run the canonical verification commands, and use ReviewGPT
  for the preliminary specialist pass and final cross-cutting gate.

## Risks and mitigations

1. Risk: oversubscription makes the 10-core worker slower or causes app-build
   memory pressure.
   Mitigation: derive one explicit CPU-bounded plan, retain build release gates,
   keep a coordinator/build reserve, and benchmark the real worker.
2. Risk: overlap hides a failed CLI or package lane.
   Mitigation: retain invocation-scoped readiness plus aggregated exit-status
   propagation and add ordering/failure regressions.
3. Risk: resource tuning leaks one operator's machine identity or becomes a
   caller override.
   Mitigation: derive only from generic CPU/profile facts, keep `static-ssh`
   executor-owned, and run a privacy diff inspection before commit.

## Tasks

1. Inspect the composed verifier and focused scheduler test seams.
2. Add the smallest CPU-bounded static-worker resource plan and direct tests.
3. Align current verification, security, reliability, architecture, and testing
   documentation with the new executor-owned plan.
4. Run focused and canonical local verification.
5. Push a candidate PR, run the preliminary ReviewGPT specialist pass, and
   resolve any accepted findings.
6. Run the production-faithful SSH acceptance benchmark, close the plan, push
   the final head, and complete final ReviewGPT plus CI/merge-conflict proof.

## Decisions

- Retain the native macOS lock as the sole whole-worker concurrency owner.
- Optimize only the verifier's inner schedule; do not add worker lifecycle or
  scheduling infrastructure.
- Admit the composed static profile only with at least 10 logical CPUs and
  24 GiB of detected physical memory. The target plan uses three two-worker
  package lanes, a three-worker CLI with one package peer during its protected
  phase, and one-worker app pools; smaller or memory-unobservable workers keep
  the prior serial fallback.
- Accept the preliminary ReviewGPT coverage finding. Its returned test-only
  patch was inspected but not applied because the parent implementation proves
  the same protected/refill transition plus the fourth-peer release and uses a
  contention-tolerant harness timeout; the canonical diff lane passes with that
  correction.

## Verification

- `bash -n scripts/workspace-verify.sh`
- Focused Vitest for `scripts/workspace-verify.test.ts`
- `pnpm test:diff scripts/workspace-verify.sh scripts/workspace-verify.test.ts`
- Exactly one final-head `MURPH_VERIFY_EXECUTOR=ssh pnpm verify:acceptance`
- Expected outcomes: focused schedule contracts pass, local diff verification
  passes, the remote resource line reports the bounded 10-core plan, acceptance
  passes, and total remote wall time is lower than 13m18s.
