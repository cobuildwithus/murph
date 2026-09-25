---
title: 'Workspace boundary scan races generated-directory replacement during a build'
severity: 'minor'
---

## Expected Behavior

The workspace import boundary check should ignore transient generator staging directories and inspect stable source files while a workspace build is running.

## Current Behavior

Running the boundary check alongside runner bundle assembly can fail with ENOENT while traversing a temporary health-commons `.generated.<nonce>.old/web/pages` directory that the generator removes. The failure occurs before reporting source import policy results.

## Possible Solution

Exclude generator staging and old-output directories from source discovery, or tolerate a disappeared non-source staging directory without hiding errors in tracked source paths.

## Minimal Reproducible Example

Run `pnpm --dir apps/cloudflare runner:bundle` and, during generated health-commons replacement, run `pnpm verify:workspace-boundaries`. The boundary scanner may enter the old generated directory before its removal. Run the boundary check after assembly finishes to avoid the race.

## Context

The race obscures validation of an import-boundary correction and forces sequential verification despite independent source checks.
