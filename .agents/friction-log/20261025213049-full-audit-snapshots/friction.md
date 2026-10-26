---
title: 'Full audit snapshots omit unchanged pnpm patch dependencies'
severity: 'minor'
---

## Expected Behavior

A guarded full source snapshot should include every repository patch referenced by its committed `patchedDependencies`, so a fresh extraction can run the supported frozen install without changing the lockfile or bypassing patches.

## Current Behavior

The full snapshot includes `pnpm-workspace.yaml` and `pnpm-lock.yaml` but omits unchanged required patch files, including `patches/incur@0.4.5.patch` and `patches/incur@0.5.1.patch`. A frozen install from the supplied snapshot fails because required patch inputs are missing.

`scripts/repo-tools.config.sh` always includes only the Codex and Cloudflare Containers patches, and its scan roots omit `patches`. The full packager includes changed file paths, but that does not recover unchanged patch dependencies. Its additional dependency-source expansion only runs for changed ReviewGPT/repo-tools patches.

## Minimal Reproducible Example

1. In an installed checkout with no patch-file changes, run `scripts/package-audit-context-full.sh --zip`.
2. Extract the resulting archive into a fresh directory without `node_modules`.
3. Compare the patch paths in `pnpm-workspace.yaml` and `pnpm-lock.yaml` with the archive contents; the pinned Incur patches are absent.
4. With Node 24.22.1 and pnpm 10.33.0, run `pnpm install --frozen-lockfile --ignore-scripts`. Required patch resolution fails before dependent builds and tests can run.

## Context

This blocks independent validation from the guarded full snapshot. Restoring the declared install inputs should preserve the existing archive privacy checks and frozen dependency contract. This is separate from #4050's native-source context and #4314's picker issue. No packaging change is included in the meal-read performance PR.
