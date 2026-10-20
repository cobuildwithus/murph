---
title: 'CLI artifact generation hides shared-host build wait progress'
severity: 'minor'
---

## Expected Behavior

`pnpm --dir packages/cli gen:config-schema` should display the prepared-runtime build's shared-host admission status while waiting for another verification owner.

## Current Behavior

The command prints `Building the CLI package.` and then remains silent for over ten minutes. `prepareBuiltCliRuntime` uses promisified `execFile`, which buffers the child output, including the host-slot helper's periodic wait messages. A caller cannot distinguish normal admission waiting from a stalled compiler without inspecting process metadata.

## Possible Solution

Stream the prepared-runtime subprocess progress while preserving its exit status and bounded failure diagnostics.

## Minimal Reproducible Example

Run canonical verification in one worktree, then run `pnpm --dir packages/cli gen:config-schema` in another while the exclusive shared-host slot is occupied. The direct build helper reports its wait; the artifact generator does not forward it.

## Context

Feature removal required regenerated CLI schemas. This did not require bypassing admission or terminating the other verification owner; it made normal progress unnecessarily opaque.
