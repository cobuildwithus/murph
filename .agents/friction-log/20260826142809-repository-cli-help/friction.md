---
title: 'Repository CLI help fails when workspace package builds are absent'
severity: 'minor'
---

## Expected Behavior

A sanctioned repository command should print `vault-cli meal edit --help` from a normal task worktree without relying on a stale global install or prebuilt unrelated workspace `dist` files.

## Current Behavior

The globally installed launcher fails while resolving a missing dependency from its installed package tree. Running the repository TypeScript CLI entrypoint instead also fails before help is rendered because a workspace runtime-state `dist` module has not been built.

## Possible Solution

Provide one repository-owned development launcher that builds or resolves the required workspace packages before CLI execution, or keep argument-level help independent of runtime-state imports.

## Minimal Reproducible Example

```sh
vault-cli meal edit --help
pnpm exec tsx packages/cli/src/bin.ts meal edit --help
```

Both commands fail before printing the meal-edit contract in an otherwise installed task worktree.

## Context

This blocked exact command discovery while verifying an assistant workflow that must use the canonical meal edit surface rather than raw vault files.
