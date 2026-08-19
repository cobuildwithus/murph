# Bounded Outbox Hot-Path Lookups

Status: active
Created: 2026-08-18
Updated: 2026-08-18

## Goal

- Remove full outbox-directory scans from exact reply and replay lookup paths by
  introducing bounded, file-native projections while preserving canonical
  intent files as the sole delivery authority.

## Success criteria

- Exact provider-message, dedupe/idempotency, and route-latest lookups perform a
  bounded number of filesystem operations independent of unrelated outbox size.
- Every positive projection hit is revalidated against the canonical intent;
  missing, stale, corrupt, or mixed-version projection state fails safely and
  remains rebuildable from canonical files.
- Creation, mutation, terminalization, cleanup, crash recovery, and concurrent
  writers preserve projection correctness without creating a second delivery
  owner.
- Focused tests, diff-aware verification, required CI, and exact-head ReviewGPT
  gates pass on the pushed pull-request head.

## Scope

- In scope: assistant outbox storage and lookup helpers, runtime-state path and
  permission contracts, hosted reply/reaction/replay callers, focused tests,
  architecture/reliability/verification documentation, and rollout notes.
- Out of scope: changing provider delivery semantics, replacing canonical
  intent files, adding a database/service/queue, or broad unrelated outbox
  refactors.

## Constraints

- Technical constraints: foreground cost must not grow with outbox history;
  projections must live under the rebuildable runtime projection taxonomy;
  canonical validation remains mandatory; all loops, recovery, and retries must
  be explicitly bounded; mixed-deploy and rollback behavior must be safe.
- Product/process constraints: use the completed ReviewGPT implementation as
  untrusted patch intent, preserve existing worktree residue, keep ReviewGPT as
  the substantive implementation/review owner, and follow the repository's
  high-risk PR lane.

## Risks and mitigations

1. Risk: projection drift returns the wrong intent or silently changes delivery
   authority.
   Mitigation: bind entries to canonical identity/fingerprints, re-read and
   validate canonical files on every positive hit, and fail closed or use only
   an explicitly bounded compatibility fallback.
2. Risk: a crash or concurrent writer publishes a projection that does not match
   the canonical mutation.
   Mitigation: use private atomic writes, deterministic reconciliation, and
   race/fault-injection coverage at each write/delete transition.
3. Risk: rollout skew causes an older runner to quarantine or ignore valid work.
   Mitigation: document deployment order and rollback floor, retain compatible
   readers where required, and test missing/corrupt/mixed-version state.
4. Risk: the optimization moves unbounded work into repair or fallback paths on
   the reply hot path.
   Mitigation: prove exact filesystem operation counts with large unrelated
   outbox fixtures and keep rebuild/maintenance off foreground execution.

## Tasks

1. Recover, inventory, privacy-check, and structurally validate the exact
   completed ReviewGPT patch.
2. Apply the patch and audit its ownership, authority, bounds, rollout, and
   test coverage against repository invariants.
3. Run focused and diff-aware verification; return substantive failures to the
   same ReviewGPT thread and integrate reviewed corrections.
4. Reconcile with the current base, close this plan, commit with the approved
   authenticated identity, push, and open the pull request with required
   architecture and hot-path evidence.
5. Start preliminary specialist and final ReviewGPT gates concurrently with CI
   on the exact pushed head, resolve actionable findings, and repeat on any new
   head until the PR is ready.

## Decisions

- Canonical intent files remain the only delivery and idempotency authority;
  lookup files are rebuildable accelerators.
- No local subagent review will be used; ReviewGPT owns the substantive review
  work as requested.
- The existing untracked specialist reports are retained as input evidence and
  are not treated as implementation authority.

## Progress

- Recovered and applied the completed ReviewGPT implementation after verifying
  its path inventory, SHA-256, text-only shape, whitespace, and privacy/secret
  boundaries.
- Returned the affected-suite failures to ReviewGPT. Its incremental correction
  removed eager read-path initialization, kept a genuinely absent publication
  canonical-only until maintenance starts the first rebuild, and strengthened
  the intentional runtime-residue observability contract.
- Verified the corrected old-base candidate with 323 assistant-engine tests,
  694 assistant-runtime tests, and the assistant-engine typecheck. The Telegram
  phone-result integration now completes under its unchanged five-second test
  limit.
- Reconciled the implementation onto the current `origin/main` with ReviewGPT,
  preserving the newer bounded reply-history semantics, orchestration
  diagnostics, and receipt mutations through the projection-aware mutation
  seam. Focused hosted-execution tests and affected package typechecks pass.
- Diff-aware verification passed repository guards (apart from four baseline
  workspace-boundary findings in untouched files), generated-artifact checks,
  CLI package-shape verification, and all affected typechecks. Its full
  assistant-engine run passed 3,820 tests and exposed 20 follow-ups: stale
  full-module mocks for the new turn-receipt reader, reply-event assertions for
  the old scan/metric contract, and one disappearing-file race. These are being
  returned to ReviewGPT before the PR head is published.
- Applied ReviewGPT's five-test correction byte-for-byte after verifying its
  declared SHA-256 and path scope. The final minimal variant preserves real
  module exports in the affected mocks, asserts bounded lookup metrics and the
  absence of canonical scans, and narrows the disappearing-file race fixture
  to the intended canonical rename. The repository's documented 6 GiB
  assistant-engine lane passes all five files (349 tests) and the package
  typecheck passes. Two later diagnostic patch variants were evaluated and
  discarded as unnecessary after identifying the repository's explicit heap
  requirement; they remain ignored audit evidence only.
- Current remaining work is publish the candidate, add the changelog entry,
  run pushed-head specialist/final ReviewGPT gates concurrently with CI, and
  complete the PR handoff.

## Verification

- Commands to run: patch structural/privacy checks; focused assistant-engine and
  runtime-state tests selected from the final path inventory; `pnpm test:diff`
  for the task diff; exact-base merge-tree checks; required GitHub Actions;
  preliminary specialist and final ReviewGPT exact-head reviews.
- Expected outcomes: bounded-call tests pass at small and large outbox sizes;
  crash/concurrency/corruption/mixed-version cases preserve canonical behavior;
  TypeScript and repository guards pass; CI and both ReviewGPT gates report no
  actionable findings.
- Completed focused proof on the pre-reconciliation base:
  - assistant-engine: 4 files, 323 tests passed;
  - assistant-runtime: 4 files, 694 tests passed;
  - assistant-engine TypeScript check passed.
- Completed post-reconciliation proof:
  - hosted-execution runtime-control tests: 32 passed;
  - assistant-engine lookup-threshold tests: 23 passed;
  - assistant-engine and hosted-execution TypeScript checks passed;
  - the 17-test projection suite passed with a diagnostic 180-second CLI-only
    timeout under host contention; repository timeouts were not changed;
  - affected package/app typechecks passed across the diff-aware workspace run;
  - the full assistant-engine suite passed 3,820 tests and failed 20 tests in
    five files plus one mock-load suite, all covered by the verified ReviewGPT
    correction;
  - corrected assistant-engine surfaces: 5 files, 349 tests passed under the
    repository's 6 GiB/single-worker lane;
  - assistant-engine TypeScript check passed after the correction.
