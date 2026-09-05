---
title: 'Required Graft command is unavailable after a fresh task checkout'
severity: 'minor'
---

Expected: Repository setup provides the `graft` command required by AGENTS.md for graph-first code context.
Current: `graft map` exits with `command not found`, so the mandated first context step cannot run.
Possible direction: Install or version Graft in the repository bootstrap, or provide a checked-in wrapper with a clear availability check.
MRE: Run `graft map` from the repository root in a fresh task worktree.
Context: This blocks the required graph-first lookup and forces narrow source-search fallback before implementation can proceed.
