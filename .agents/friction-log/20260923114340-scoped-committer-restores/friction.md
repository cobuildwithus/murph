---
title: 'Scoped committer restores stale staged content after an edited rename'
severity: 'minor'
---

## Expected Behavior

After committing both paths of an edited rename, the task worktree and index should agree with the new commit when no unrelated edits remain.

## Current Behavior

The scoped committer records the correct renamed file and edited contents in HEAD, but restores the old staged blob at the new path. Git reports MM even though the working file equals HEAD. A subsequent merge refuses to proceed until the task-owned index entry is reset to HEAD.

## Minimal Reproducible Example

In a task checkout, track a small JSON file. Run `git mv old.json new.json`, edit one field in new.json, and invoke `scripts/committer "Rename fixture" old.json new.json`. Compare `git diff HEAD -- new.json` with `git diff --cached -- new.json`: the former is empty while the latter reverses the committed edit. `git restore --staged -- new.json` clears only the stale task-owned staging residue.

## Possible Solution

When restoring unrelated staging after a scoped commit, exclude both source and destination paths of every committed rename.

## Context

This blocked a routine base merge after an isolated changelog filename collision. No production data or behavior is involved.
