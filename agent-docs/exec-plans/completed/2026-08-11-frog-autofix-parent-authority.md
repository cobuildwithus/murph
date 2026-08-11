# Frog Autofix Parent Authority

## Goal

Make the local Frog repair loop enforceable rather than self-attested: an
edit-only Codex child may prepare a repair, while the non-model parent owns
ReviewGPT, Git, GitHub, review state, PR publication, required-check
observation, merge, and issue closure. Automatically merge only changes that a
narrow deterministic allowlist proves are local agent/Codex workflow changes;
leave every possible product-runtime change open for human approval.

## Finding dispositions

1. Accepted: remove the child's network, browser-profile, Git-common-directory,
   SSH-agent, commit, PR, review, merge, and issue-close authority. Parent-owned
   review material must live outside child-writable paths.
2. Accepted: after a safe default-branch fast-forward, continue issue discovery
   unless the files already loaded by the running launcher changed.
3. Accepted: reset an interrupted issue worktree only when there is no commit,
   PR, remote branch, divergence, or other ownership ambiguity. Preserve and
   resume dirty work only when one open issue-closing PR, its remote branch,
   and the local committed head all bind the same repair.
4. User policy: immediately before merge, classify every PR path and any
   narrowly exceptional hunk. Auto-merge only proven local agent/Codex tooling;
   otherwise stop with the reviewed PR and Frog issue open.

## Success criteria

- A Codex child runs with workspace-only writes, no tool-network access, no SSH
  agent, no browser profile, no Git common directory, and no parent review or
  GitHub evidence path.
- The parent obtains and validates the required ReviewGPT implementation patch,
  applies it, asks the child only for local integration and proof, and owns all
  commits, pushes, PR metadata, ReviewGPT gates, CI observation, merge, and
  issue closure.
- Parent review responses and model-verification records are bounded,
  owner-only, outside the issue worktree, and never accepted from the child.
- A clean primary fast-forward continues in the same run when launcher code is
  unchanged and exits exactly once when the loaded launcher changed.
- Safe dirty-worktree recovery cleans unowned fresh interruption residue and
  resumes one exact PR/head-bound dirty repair; divergence or ambiguous
  ownership remains fail-closed.
- Product-runtime classification is deterministic, narrow, revalidated against
  the exact PR head immediately before merge, and has focused allow/pause tests.
- Focused tests, repository-tool tests, typecheck, parent review, the next final
  ReviewGPT round, exact-head CI, and current-base merge proof pass before the
  local-tooling PR is merged and the LaunchAgent is reinstalled.

## Tasks

1. [x] Replace worker readiness with an edit-only child and parent-owned
   implementation-patch, Git, PR, review, and CI phases.
2. [x] Add deterministic local-tooling merge classification and human-pause
   behavior for every other path.
3. [x] Fix same-run primary advancement and safe interrupted-worktree recovery.
4. [x] Add focused authority, recovery, classification, and lifecycle coverage;
   update architecture, security, reliability, and operator docs.
5. [x] Run focused, diff-wide, docs-drift, shell, TypeScript, privacy, and
   current-base merge-tree proof for the commit candidate.
6. [x] Record the post-commit delivery contract: update the PR, obtain final
   ReviewGPT PASS and green exact-head CI, classify the exact diff immediately
   before merge, then reinstall and exercise the scheduled runner end to end.

Status: completed
Updated: 2026-08-11
Completed: 2026-08-11
