# Repair scoped committer staging for tracked ignored paths

Status: completed
Created: 2026-08-29
Updated: 2026-08-29

## Goal

- Let the scoped committer update or delete an exact path already tracked by
  its isolated base index even when a local exclude rule ignores the parent,
  without weakening exact-path admission for new untracked files.

## Success criteria

- A real-Git regression reproduces the installed committer failure before the
  patch and passes afterward.
- Tracked changes use update-only staging; new selected files retain ordinary
  add semantics and ignored new files remain rejected.
- Hooks, exact selected paths, real-index preservation, and scoped commit
  behavior remain owned by the pinned repo-tools committer.
- Focused tests, dependency-policy proof, tooling typecheck, and repository
  completion checks pass on the exact candidate.

## Scope

- In scope: the pinned repo-tools committer patch, installed-runtime regression
  coverage, patch inventory, and directly affected workflow documentation.
- Out of scope: `finish-task` plan archival, hook behavior, broader staging
  semantics, upstream release work, or another repository's artifacts.

## Constraints

- Technical constraints: distinguish paths from the isolated comparison index,
  not the caller's mutable real index; retain literal exact pathspecs and fail
  closed for ignored untracked additions.
- Product/process constraints: no deployed/member behavior; keep PR Draft until
  exact-head review capacity and required CI admission are available.

## Risks and mitigations

1. Risk: using update-only staging for every selected path would silently omit
   legitimate new files.
   Mitigation: partition selected paths by their presence in the isolated base
   index and preserve `git add -A` for only the new/untracked partition.
2. Risk: a forced add could bypass a repository-local ignore boundary.
   Mitigation: do not force-add; prove ignored new files remain rejected.

## Tasks

1. Completed: revalidated authority, ownership, and the current pinned tool
   implementation.
2. Completed: added and ran a hermetic real-Git failing regression against the installed
   committer.
3. Completed: patched the owning repo-tools implementation with the smallest
   staging split.
4. Completed: ran focused and completion verification and inspected the
   candidate before commit.
5. Pending after this commit: push a Draft PR, run the applicable exact-head reviews and CI, then land only
   if every current policy gate permits autonomous merge.

## Decisions

- Reuse a reviewed pnpm patch rather than duplicate the committer in Murph's
  thin wrapper.
- Keep Draft PR #2537 as non-authoritative related evidence; do not consume or
  reproduce its separate `finish-task` plan-archive change.

## Verification

- Pre-fix proof: the real-Git installed-runtime fixture failed only the tracked
  ignored update because the temporary `git add -A` rejected its parent.
- Focused result: 3/3 installed-committer cases and 3/3 dependency-policy cases
  passed; the release patch-inventory audit passed.
- Broader result: `pnpm test:repo-tools` passed 50 files / 681 tests; repo-tools
  and CLI TypeScript checks passed.
- Completion result: frozen install, patched shell syntax, dependency policy,
  ignored-build inventory, docs drift/gardening, diff hygiene, and the
  public-safety scan passed.
- Dependency audit: the existing advisory backlog remains red; the lock diff
  changes only the repo-tools patch hash and no package version or transitive
  edge.
- Remaining PR gates: exact-head ReviewGPT, required GitHub checks, and a
  current-main merge-tree proof.
Completed: 2026-08-29
