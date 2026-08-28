---
title: 'CLI config-schema generation assumes prebuilt workspace dependencies'
severity: 'minor'
issue: 'cobuildwithus/murph#2491'
---

## Expected Behavior

Running `pnpm --filter @murphai/murph gen:config-schema` in a fresh authorized worktree should build the inputs it needs or route through the repository’s dependency-aware build entrypoint, then verify the committed CLI schema.

## Current Behavior

The generator directly invokes the CLI package build. In a fresh worktree, workspace dependency `dist` outputs do not exist, so TypeScript reports missing public package entrypoints across the CLI and the pre-commit hook only warns that schema generation failed. The focused source typecheck still succeeds because it resolves source-aware workspace paths.

## Possible Solution

Make the generator or hook invoke the smallest dependency-aware prepared build before the CLI package build, or provide a source-aware schema generation path that does not require every dependency output. Preserve the committed-schema drift check after generation.

## Minimal Reproducible Example

Create an authorized worktree from a clean commit, install with the frozen lockfile, change a CLI command option, and run `pnpm --filter @murphai/murph gen:config-schema`. Observe missing workspace-package build outputs before schema generation begins.

## Context

This leaves a CLI contract change locally typechecked but unable to prove its generated schema without discovering and running a broader build workaround.
