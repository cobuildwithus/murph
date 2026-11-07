---
title: 'Codex upgrade test command omits built CLI prerequisite'
severity: 'minor'
issue: 'cobuildwithus/murph#4446'
---

## Expected Behavior

The testing map's Codex upgrade command should run its selected scripted-runtime suite in a freshly installed checkout, or state the required CLI build prerequisite.

## Current Behavior

The two common-list-limit provider-input cases require packages/cli/dist/bin.js. After pnpm install, the documented focused command fails before starting either scenario because that built CLI is absent.

## Possible Solution

Document the existing workspace incremental build prerequisite alongside the Codex upgrade commands, or use the repository's existing prepared-runtime entrypoint.

## Minimal Reproducible Example

In a fresh checkout without build output, run pnpm install, then the testing map's assistant-engine Codex command. The direct and group common-list-limit cases report that the required built workspace CLI is unavailable. Run pnpm build:workspace:incremental before retrying those cases.

## Context

Observed during a bounded Codex CLI upgrade. This is a local test prerequisite, not a provider or production failure.
