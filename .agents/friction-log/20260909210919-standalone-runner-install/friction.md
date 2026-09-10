---
title: 'Standalone runner install changes a workspace dependency after a Web-only addition'
severity: 'minor'
---

## Expected Behavior

A runner assembled from a frozen workspace should keep the versions used to build its staged workspace packages. Adding a dependency used only by the Web app should not silently change the runner's existing schema runtime.

## Current Behavior

Adding Better Auth introduces Zod 4.5.4 into the root lockfile. Workspace packages still resolve their existing Zod dependency to 4.4.3, but their staged tarball manifests retain the range. The standalone installer strips root importers and resolves the range to the newly available 4.5.4. The resulting CLI grows by 153704 bytes and fails the unchanged relative CI allowance. Restoring an unrelated OpenAI peer resolution does not fix this.

## Possible Solution

Limit the standalone resolution seed to package versions in the runner production closure, obtained through the pinned pnpm list command against the committed lockfile. Keep source manifests and size budgets unchanged. Real assembly and command-parity probes verify the result.

## Minimal Reproducible Example

Use the existing stripPnpmLockfileImporters helper to seed a standalone synthetic package with dependency zod at range ^4.4.3. With the earlier root lockfile, an offline lockfile-only install selects 4.4.3. With the Web dependency added to the root lockfile, the same synthetic manifest selects 4.5.4. The ordinary runner bundle command reproduces the output growth.

## Context

This blocks the authentication migration's exact-head CI despite unchanged runner source and passing application tests. It also exposes an unintended dependency change outside the Web app.
