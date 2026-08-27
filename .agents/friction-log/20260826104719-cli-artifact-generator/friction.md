---
title: 'CLI artifact generator stays silent for several minutes after build'
severity: 'minor'
---

## Expected Behavior

`pnpm --dir packages/cli gen:config-schema` should generate the committed Incur types, config schema, and skill hash or fail with an actionable bounded error.

## Current Behavior

After the package build succeeds, the command enters `incur gen` and remains silent for several minutes with no progress or stage diagnostic. Two attempts were interrupted after more than a minute because there was no way to distinguish slow progress from a stuck import; a later attempt eventually completed.

## Possible Solution

Add a bounded timeout and surface which entrypoint-import or schema-generation stage is still pending.

## Minimal Reproducible Example

1. Build the CLI package successfully.
2. Run `pnpm --dir packages/cli gen:config-schema`.
3. Observe that generation produces no output and does not terminate.

## Context

This blocks required refresh and verification of committed generated CLI artifacts after a command grammar change.
