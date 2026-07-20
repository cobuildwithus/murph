# Bound local test and checkout storage

Status: completed
Created: 2026-07-19
Updated: 2026-07-19

## Goal

- Stop ordinary Murph tests and unmanaged temporary checkouts from rebuilding
  the recent local-storage leak, then remove the user-authorized stale test,
  Rust, and iOS build artifacts without touching active, dirty, open-PR, or
  data/research work.

## Success criteria

- Ordinary Vitest runs place temporary files beneath one marked run root and
  remove that root at teardown, including after test failures.
- A later run can remove only old marked roots whose owner is gone and which no
  current-user process uses as its working directory.
- The existing worktree guard ratchets unmanaged temporary Murph checkouts down
  instead of allowing their count to grow, while preserving registered and
  explicitly data/research worktrees.
- Durable agent instructions explain the owned temp lifecycle, the unmanaged
  checkout prohibition, the dry-run/apply cleanup surface, and fail-closed
  exceptions.
- The authorized stale test roots, one Rust `target`, and two closed iOS
  experiment build-output sets are removed after immediate cleanliness, PR,
  and live-process revalidation.

## Scope

- In scope: shared Vitest configuration and temp lifecycle tooling; the
  worktree storage guard and focused tests; current agent/workflow/testing
  documentation; exact cleanup of the three user-approved storage classes.
- Out of scope: active/open-PR checkout source, dirty repositories, research or
  downloaded-data work, global Xcode/Simulator state, Codex session history,
  Docker storage, unrelated caches, and any process not started by this
  session.

## Constraints

- Technical constraints: default cleanup commands to inspection; recognize
  only marked run roots or explicitly supplied exact paths; never recursively
  target a home directory, workspace root, temp root, or unresolved glob; use
  bounded parallel deletion only after exact target validation.
- Safety constraints: preserve any target with an open PR, dirty Git state,
  active plan/ledger evidence, explicit data/research classification, or a
  current-user process working inside it. Do not terminate foreign processes.
- Checkout constraint: the regular-worktree guard currently reports 62 regular
  worktrees against a ratcheted ceiling of 62 and an absolute target of 40, so
  `scripts/create-worktree` cannot create the normal isolated task checkout.
  The clean primary checkout is used for this storage-remediation task without
  bypassing the guard.

## Risks and mitigations

1. Risk: a broad temp-name rule could delete real research or an active
   checkout.
   Mitigation: automatic lifecycle cleanup is marker-based; legacy removal uses
   exact inspected paths, and checkout/build cleanup revalidates Git, PR, and
   process state immediately before deletion.
2. Risk: concurrent Vitest runs could remove one another's files.
   Mitigation: each process gets a unique marked run root; stale collection
   requires age, dead-owner, and process-CWD proof.
3. Risk: a hard-killed test runner can skip teardown.
   Mitigation: the next run performs a bounded stale-root sweep, while a
   manual dry-run/apply command exposes the same owner.
4. Risk: millions of small files make serial deletion excessively slow.
   Mitigation: validate top-level targets first, then remove independent roots
   concurrently with a bounded worker count and report actual filesystem space
   separately from APFS apparent size.

## Tasks

1. Trace the leaked directories to their creating tests, checkout workflows,
   package-store isolation, and iOS build invocations.
2. Add the marked Vitest run-root lifecycle, stale-root cleanup command, and
   focused failure/ownership tests.
3. Extend the worktree storage guard with a machine-local ratchet for unmanaged
   temporary Murph checkouts and document the lifecycle.
4. Run focused and diff-aware verification, direct dry-run/apply scenario
   checks, coverage-write, local deep-review, and parent final review.
5. Revalidate and delete the authorized legacy temp/test roots, stale Rust
   target, and closed iOS build outputs; measure free space and remaining
   skipped classes.
6. Close the plan and ledger through `scripts/finish-task` with a scoped commit.

## Decisions

- Prevent the dominant test leak at the shared Vitest boundary rather than
  adding cleanup boilerplate to hundreds of individual tests.
- Keep abrupt-run recovery marker-based; do not infer deletability from a broad
  `murph-*` name alone.
- Extend the existing worktree storage owner rather than create a second
  checkout registry or daemon.
- Preserve currently active/open-PR temporary checkouts; the ratchet prevents
  new unmanaged growth and reaches zero as preserved legacy work retires.

## Verification

- Commands to run: focused repo-tool tests for the lifecycle and worktree
  guard; a small deliberately failing Vitest fixture proving teardown; direct
  stale/live/foreign-marker cleanup scenarios; `pnpm test:diff` for every
  touched tooling/config path; `git diff --check`; required `coverage-write`
  and local `deep-review`; exact pre/post `df` plus path-existence checks for
  cleanup targets.
- Expected outcomes: tests and guards pass; failed tests leave no per-test
  vaults; active or ambiguous roots are reported and preserved; approved build
  outputs are absent; no unresolved accepted audit finding remains.
Completed: 2026-07-19
