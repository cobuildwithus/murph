---
title: 'Codex worktree setup receives no CODEX_HOME'
severity: 'minor'
---

## What happened

The managed task shell did not expose `CODEX_HOME`, so a repo-compliant worktree target built from `$CODEX_HOME/worktrees` collapsed to `/worktrees` and failed before checkout creation.

## Expected

Managed Codex task shells should expose the active Codex home, or the sanctioned worktree helper should resolve the active home itself, so agents can follow the repository worktree-location rule without guessing.

## Workaround

Resolve the active existing Codex home from the current session metadata, then pass its established `worktrees` child explicitly to the sanctioned helper.
