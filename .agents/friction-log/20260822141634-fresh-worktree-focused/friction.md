---
title: 'Fresh worktree focused Web Vitest requires undeclared Prisma generation'
severity: 'minor'
---

## Expected Behavior

The documented focused Web Vitest command should run successfully after a frozen-lockfile install in a newly sanctioned worktree.

## Current Behavior

The focused suite fails during import because the generated Prisma client is absent. Running Web typecheck first generates the client, after which the unchanged focused command passes.

## Possible Solution

Make the focused Web test entrypoint generate or verify the Prisma client before Vitest imports Web modules.

## Minimal Reproducible Example

1. Create a sanctioned fresh worktree.
2. Run pnpm install --frozen-lockfile.
3. Run the focused hosted Web Vitest command.
4. Observe the missing generated Prisma client import failure.
5. Run the Web typecheck, then rerun the same test and observe it pass.

## Context

This creates a false negative for focused verification in clean task worktrees and makes test order an undeclared prerequisite.
