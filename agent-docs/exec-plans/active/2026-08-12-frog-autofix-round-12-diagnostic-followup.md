# Frog Autofix Round 12 Diagnostic Follow-up

## Goal

Correct the two reachable findings from the invalid round-12 diagnostic while
preserving the existing retry, task-authority, PR-body, and queue owners.

## Findings

- Post-worker fetch or GitHub failures were caught as terminal `worker-output`
  and could replace a valid committed candidate with an empty handoff.
- Task drift after a resumed local descendant commit could not bind the human
  handoff to the unchanged existing PR head, leaving the oldest issue pinned.
- Trusted ReviewGPT controls could change during a long review or CI wait while
  the previously produced PASS still retained unattended merge authority.
- Loaded Frog authority modules could change on `main` after invocation start
  while the old in-memory parent still retained response and merge authority.
- Persisted PASS metadata did not retain its producing runner version, so a
  restart under newer authority could reuse review evidence from the old one.
- Automatic primary source advancement could leave parent ReviewGPT and helper
  binaries installed from an older manifest or lockfile.

## Design

- Keep deterministic worker-output and local candidate checks inside the
  terminal classifier, then perform the fresh task refresh after the local
  parent commit and outside that classifier. Infrastructure failures remain
  retryable; actual task drift still enters the authority handoff.
- For an unchanged exact parent-owned PR, permit only an unpushed local
  descendant whose existing PR head is a proven ancestor. Discard that local
  descendant, preserve the private marker, normalize to the existing PR head,
  and write the handoff to that exact head without pushing candidate bytes.
- Fail closed on a changed projection, non-ancestor, missing commit, or foreign
  ownership.
- Reuse the existing trusted-control comparison after every long canonical
  review and at both finalization refreshes. Any drift uses the existing exact-
  head review-findings handoff and never reaches merge or issue closure.
- Snapshot the primary head that loaded the runner and compare the existing
  loaded-runner inventory to freshly fetched `origin/main` at the same fences.
  Unrelated default-branch movement remains allowed; loaded authority drift
  uses the same exact-head handoff.
- Bind specialist and final PASS metadata to the producing runner head. Reuse
  requires that exact candidate/runner pair and fresh loaded-path equivalence;
  legacy, malformed, or drifted evidence uses the existing handoff.
- Reconcile the clean primary dependency tree with frozen lockfile and disabled
  lifecycle scripts before loading the mutating parent, include the lockfile in
  trusted review controls, and restart once after dependency-control advances.

## Verification

- Source-order proof for retryable post-worker authority infrastructure.
- Real-Git descendant normalization and non-ancestor rejection.
- Existing-PR projection, no-push, exact-body, and queue-handoff guards.
- Post-review and pre-merge trusted-control and loaded-runner drift handoff
  guards, with unrelated default-branch movement preserved.
- Real-Git cross-invocation PASS reuse for unchanged, unrelated-main, legacy,
  and loaded-authority-drift cases; shell-order proof that frozen primary
  dependency reconciliation precedes the TypeScript parent.
- Focused Frog suite, repo tooling, workspace typecheck, docs/shell/permission
  guards, privacy checks, current-base merge tree, and a fresh valid exact-head
  ReviewGPT round.

## Progress

- [x] Validate the diagnostic findings against the production path.
- [x] Separate authority refresh from terminal worker-output classification.
- [x] Normalize proven unpushed descendants to the unchanged existing PR head.
- [x] Add production-shaped proof and update owner documentation.
- [x] Fence accepted review evidence and final merge on current trusted controls.
- [x] Fence accepted review evidence and final merge on the loaded runner version.
- [x] Bind persisted PASS evidence to its producing runner version.
- [x] Reconcile primary executable dependencies before mutating parent startup.
- [ ] Verify, commit, push, and continue exact-head review and CI.
