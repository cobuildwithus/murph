---
title: 'Frog autofix worker sandbox denies its Codex executable'
severity: 'major'
---

## Expected Behavior

After ReviewGPT supplies a valid implementation patch, the Frog autofix parent should start its existing edit-only Codex worker inside the restricted workspace profile so the worker can verify the candidate and prepare the parent-owned pull request evidence.

## Current Behavior

The restricted profile denies the installed Codex executable before a worker session can initialize. Codex re-executes its current binary while loading repository instructions, but the binary is installed outside the issue worktree and outside the profile's minimal read set. The macOS sandbox therefore rejects the self-exec with `Operation not permitted`, the worker exits immediately, and Frog converts the otherwise valid repair into an empty human-review handoff.

## Possible Solution

Keep the existing network denial, workspace-only file access, ephemeral session, clean environment, and parent ownership. Materialize the exact resolved Codex executable into an owned private directory inside the issue worktree before launch, execute that copy, and remove it with the existing worker-output cleanup. Add a regression proving the real worker can initialize while reads and writes outside the worktree remain denied. Do not grant read access to a general local bin, package, home, or configuration tree.

## Minimal Reproducible Example

Install Codex in a user-local path outside a clean Frog issue worktree. Invoke `codex exec` with the production `frog-workspace-only` profile and a no-edit prompt. Session creation fails before the prompt runs because the sandbox cannot execute the installed Codex path. Copying the same resolved executable into an ignored directory beneath the issue worktree and invoking that copy succeeds under the otherwise unchanged profile.

## Context

The implementation-review browser lane and patch artifact both succeeded for the canary repair. This later worker-launch boundary is the sole observed blocker. The candidate patch was not published, and the parent correctly retained review, Git, GitHub, merge, and issue-closure authority.
