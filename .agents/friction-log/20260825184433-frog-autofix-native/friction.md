---
title: 'Frog autofix native gate rejects the shipped launcher'
severity: 'major'
---

## Expected Behavior

Running scripts/frog-autofix install or run through the shipped wrapper should acquire the native lock and pass the parent-process gate before any mutation begins.

## Current Behavior

The wrapper acquires the native lock correctly, then invokes the TypeScript entrypoint through the tsx executable shim. That shim creates an intermediate Node process. The entrypoint requires its immediate parent command to be /usr/bin/lockf, so the normal supported launcher rejects itself with the native-launcher-gate error. Installation and every scheduled or manual mutating run are blocked.

## Possible Solution

Keep the existing native lock, fail-closed contender check, and environment marker, but make the trusted launcher topology and the entrypoint validation agree. Prefer the smallest change in the existing scripts/frog-autofix family with a regression that executes the real wrapper boundary; do not broaden authority or add a dependency.

## Minimal Reproducible Example

On a clean macOS primary checkout with frozen dependencies installed, run scripts/frog-autofix install. Dependency and permission checks succeed, then the command exits at the native acquisition assertion. A direct diagnostic under the same lock shows the wrapper starts beneath /usr/bin/lockf, while the TypeScript process reached through node_modules/.bin/tsx has node as its immediate parent.

## Context

This prevents the local two-hour Frog autofix LaunchAgent from installing or processing any eligible issue. The defect is limited to the local Frog autofix launcher and its focused tests, making it suitable for the narrow autonomous-repair allowlist.
