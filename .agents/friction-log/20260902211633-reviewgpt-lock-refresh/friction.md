---
title: 'ReviewGPT lock refresh drops the patched Incur resolution'
severity: 'minor'
issue: 'cobuildwithus/murph#2755'
---

## Context

Updating the root `@cobuild/review-gpt` dependency while rebinding its existing package patch.

## Friction

`pnpm install --lockfile-only` re-resolved the caret-ranged `incur` dependency to a newer 0.4.x release, then failed with `ERR_PNPM_UNUSED_PATCH` because Murph intentionally patches exact `incur@0.4.5`. The targeted `pnpm update --depth 0` path failed the same way.

## Impact

The supported dependency-edit commands cannot produce the narrow ReviewGPT-only lockfile update that repository policy requires. A maintainer must preserve the existing locked transitive and update the ReviewGPT resolution fields manually, then prove the result with a frozen install.

## Suggested improvement

Add a repository-owned helper for version-only updates of patched direct dependencies, or explicitly pin the patched transitive at its owning dependency boundary so ordinary lockfile regeneration remains deterministic.
