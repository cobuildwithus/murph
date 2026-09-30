---
title: 'Fresh Web typecheck requires an unprepared clinical importer export'
severity: 'minor'
---

## Expected Behavior

The Web typecheck command prepares its required generated declarations or resolves declared workspace source entries in a fresh checkout.

## Current Behavior

After a frozen install, Web typecheck fails with TS2307 for the clinical-records subpath of the importers package, imported by vault-usecases. The Web configuration maps other importer source entries but omits this subpath, whose package export points to dist.

## Minimal Reproducible Example

In a fresh authorized checkout, run `pnpm install --frozen-lockfile`, then `pnpm --dir apps/web typecheck` before building the importers package.

## Possible Solution

Prepare the importer declarations through the existing build owner, or add this declared public entrypoint to the established Web source-resolution contract.

## Context

This blocks focused Web verification until the missing dependency artifact is prepared. No production data is required to reproduce it.
