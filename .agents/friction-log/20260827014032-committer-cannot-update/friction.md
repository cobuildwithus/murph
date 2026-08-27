---
title: 'Committer cannot update tracked files under ignored directories'
severity: 'minor'
---

## Expected Behavior

The scoped committer should update an explicitly selected tracked file even when a local repository exclude rule also ignores its parent directory.

## Current Behavior

The committer rebuilds a temporary index with `git add -A` for the canonical selected paths. Git rejects the selected tracked file as ignored, so the guarded commit cannot proceed even though the real index already contains the scoped tracked modification.

## Possible Solution

Separate tracked updates from untracked additions in the temporary index, or force-add only the already-canonicalized selected paths.

## Minimal Reproducible Example

1. Track `evidence/result.md` in a repository.
2. Add `evidence/` to the repository-local exclude file.
3. Modify `evidence/result.md`.
4. Run the scoped committer with that exact file path.
5. Observe the ignored-path rejection while ordinary `git add -u -- evidence/result.md` succeeds.

## Context

Completion-audit evidence is tracked under a locally ignored directory. The rejection blocks the repository-required commit wrapper and forces a tool-local workaround while preserving hooks and scoped-path safeguards.
