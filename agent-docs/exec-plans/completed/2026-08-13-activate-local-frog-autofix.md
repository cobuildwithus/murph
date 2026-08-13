# activate-local-frog-autofix

Status: completed
Created: 2026-08-13
Updated: 2026-08-13

## Goal

- Install and activate the already reviewed local Frog autofix source in the
  Murph repository, then prove one genuine eligible Frog issue reaches its
  intended GitHub terminal state under the existing authority gates.

## Success criteria

- Current Murph `main` contains the byte-identical reviewed Frog runtime and
  the target-local package, review-packaging, architecture, security,
  reliability, and verification contracts it requires.
- Focused Frog, review-packaging, shell, typecheck, documentation, privacy, and
  permission checks pass; required exact-head CI and ReviewGPT gates pass.
- The clean primary checkout installs a two-hour LaunchAgent and reports
  `loaded=yes`.
- A foreground invocation admits one real App-authored, committed Frog issue
  and reaches either automatic merge plus issue closure or the designed
  durable human-handoff terminal state without weakening a gate.

## Scope

- In scope: target-embedded Frog runtime, package entrypoint, canonical
  target-local contracts and proof, installation, one observed real run.
- Out of scope: changes to the private source repository, product/runtime
  behavior, new issue fabrication, bypassing branch protection, broad cleanup
  of the existing Frog backlog.

## Constraints

- Technical constraints: the runtime executes only from an exact clean Murph
  primary checkout; GitHub, ReviewGPT, Codex, worktree, process, and merge
  authority remain parent-owned and fail closed.
- Product/process constraints: preserve unrelated worktrees and local changes;
  use the sanctioned worktree/PR lane; do not use admin merge or weaken
  required reviews/checks.

## Risks and mitigations

1. Risk: stale reviewed files overwrite newer Murph contracts.
   Mitigation: copy only the ten byte-identical runtime files and integrate the
   isolated contract sections into current `main` rather than replaying the old
   branch.
2. Risk: a model or stale invocation crosses an irreversible boundary.
   Mitigation: retain the reviewed exact-head, task-digest, loaded-runner,
   review-control, PR-provenance, required-check, and merge-tree fences.
3. Risk: installation or a worker process becomes ambiguous.
   Mitigation: use the reviewed native lock/process-tree ownership logic and
   stop only exact processes started by this session.

## Tasks

1. Merge the existing App-owned reconciliation PR after its required checks so
   committed issue bindings exist on `main`.
2. Integrate the reviewed runtime and target-local controls on a sanctioned
   activation branch.
3. Run focused verification, inspect the complete diff, and publish a draft PR.
4. Complete preliminary and final ReviewGPT gates concurrently with CI,
   remediate any accepted findings, and merge without bypass.
5. Install from the exact clean primary checkout, verify permissions/status,
   run once in the foreground, and babysit the resulting issue/PR lifecycle.

## Decisions

- Reuse the existing real Frog backlog; do not create a synthetic issue.
- Treat private-repository publication as source ownership only. Activation is
  a separate Murph target deployment because the runtime's trust fences are
  deliberately target-local.
- Preserve the persistent `frog/sync` branch when merging reconciliation PRs.
- Reuse the reviewed source byte-for-byte from the private source repository;
  integrate only its isolated target-local contract sections into current
  Murph docs and retain current unrelated packaging behavior.

## Verification

- `pnpm exec vitest run scripts/frog-autofix.test.ts --config scripts/vitest.config.ts --no-coverage`
- `pnpm exec vitest run packages/cli/test/release-script-coverage-audit.test.ts --config packages/cli/vitest.workspace.ts --no-coverage`
- `bash -n scripts/frog-autofix scripts/package-audit-context-full.sh`
- `scripts/frog-autofix verify-permissions` and `scripts/frog-autofix scan`
- Murph typecheck, docs/reference checks, privacy scan, exact-head required CI,
  preliminary specialist ReviewGPT, final ReviewGPT, and current-base
  `git merge-tree --write-tree` must all pass.

Current candidate proof:

- Frog suite: 50 passed.
- ReviewGPT packager regression suite: 43 passed, 1 existing
  environment-dependent skip.
- Native worker permission profile: passed.
- Shell and dependency-bootstrap syntax: passed.
- Live read-only queue scan: 36 eligible issues, oldest issue 1635.
- Full typecheck: passed; the non-failing boundary reporter also repeated two
  unchanged current-main Web-test warnings outside this diff.
- Documentation drift and gardening: passed with zero issues.
- Diff-aware verifier: repo-tools phase passed 591 tests and affected CLI
  typecheck passed; the broad unchanged assistant-CLI bucket produced eight
  60-second scenario timeouts and was stopped after no further useful output.
  The directly affected focused suites above remain green; exact-head CI owns
  the broad PR proof.
Completed: 2026-08-13
