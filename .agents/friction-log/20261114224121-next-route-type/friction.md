---
title: 'Next route-type fixture can replace the app dependency links'
severity: 'minor'
issue: 'cobuildwithus/murph#4996'
---

## Expected Behavior

The native route-type test uses installed dependencies without changing the app's node_modules directory.

## Current Behavior

The fixture in apps/web/test/production-next-build-runner.test.ts symlinks the app node_modules directory into a temporary project. That project cannot resolve the workspace-root @types/node dependency. Next typegen invokes a package manager to install it through the symlink, replacing app dependency links and causing subsequent tests to fail imports.

## Possible Solution

Give the fixture an isolated dependency directory with explicit links to all Next typegen prerequisites, including @types/node.

## Minimal Reproducible Example

Run the full Web suite in a clean source archive with copied pnpm dependencies. Observe the native route checking test followed by missing react and Prisma imports. Providing an app-local link to the existing workspace @types/node avoids the install.

## Context

Encountered during a clean-main baseline for HTTP error-classification integration. No product behavior is involved.
