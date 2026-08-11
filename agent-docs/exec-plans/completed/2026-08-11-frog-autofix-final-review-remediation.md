# Frog Autofix Final Review Remediation

## Goal

Resolve the accepted final ReviewGPT round-one findings on PR #1647 while
preserving the user's autonomous local repair outcome and ordinary repository
merge policy.

## Finding dispositions

1. Rejected with production evidence: `gh issue view 1635 --json author`
   returns `app/murph-frog-reconciliation`, exactly matching the GraphQL author
   field consumed by the parent and child. The `[bot]` workflow variable is a
   different API representation. Add a literal fixture so this distinction
   cannot drift silently.
2. Accepted: live issue authority must be revalidated by the non-model parent
   at the irreversible merge boundary.
3. Accepted: the invocation deadline must include every parent-side external
   command, not only the Codex worker.
4. Accepted: direct-child exit is not proof that the detached process group is
   gone.
5. Accepted: a historical merged PR must never auto-close an intentionally
   reopened issue; delete `close-issue` recovery.
6. Accepted: the Frog entry is required by the repository skill, but its public
   issue/reconciliation side effect must be disclosed in the PR contract.

## Success criteria

- The child may prepare a clean committed branch, PR, ReviewGPT evidence, and
  green checks, but cannot be the workflow's merge/issue-close decision owner.
- The parent accepts a bounded readiness manifest only when exact ReviewGPT
  response/model evidence, PR head, required checks, and clean current-base
  merge proof validate. It then re-fetches and revalidates issue state, App
  author, label, and exactly one committed binding immediately before an
  ordinary head-matched squash merge.
- A historical merged PR plus open/reopened issue is ambiguous and issues no
  worker or close command.
- One absolute invocation deadline bounds parent commands and the child wait.
- Worker supervision does not release cleanup/lock ownership until the exact
  detached process group disappears, including leader-first exit.
- Focused real/fake lifecycle proof, repository tools, typecheck, exact-head CI,
  and a later final ReviewGPT PASS complete before merge.

## Tasks

1. [x] Remove close-only mode and render implement/resume prompts only.
2. [x] Add child readiness evidence plus parent-owned deterministic finalize/merge.
3. [x] Add absolute parent command deadlines and process-group disappearance
   supervision.
4. [x] Add production-shaped author, revoked-authority, stale-evidence/head/check,
   reopen, hanging-command, and leader-first-descendant coverage.
5. [x] Update owner docs and run focused/full repository-tool proof. Commit the
   remediation candidate; the PR loop retains ownership of final ReviewGPT
   round 2, exact-head CI, ordinary merge, and post-merge installation.

## Scope retrospective

The immutable first-reviewed head added 1,770 source lines. Round-one review
found three coupled authority/lifecycle gaps whose smallest durable correction
requires parent-side readiness validation, a reusable deterministic finalizer,
and one exact process-group command runner. The remediation adds more than 500
source lines and exceeds 25 percent of the first-reviewed source additions, so
the scope anomaly is real. Continuing is preferable to shrinking the patch by
dropping executable boundary proof: each new module has one owner, replaces
model-owned irreversible actions or unbounded subprocess behavior, and avoids a
second queue, service, credential, or hosted runtime.
Status: completed
Updated: 2026-08-11
Completed: 2026-08-11
