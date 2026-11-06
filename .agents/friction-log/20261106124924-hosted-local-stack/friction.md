---
title: 'Hosted-local stack tunnel assertion depends on the Vitest launch directory'
severity: 'minor'
---

## Expected Behavior

The focused stack suite should pass with its package config when launched from either the repository root or the package directory.

## Current Behavior

The managed Linq tunnel test builds its fixture config path from process.cwd(), but expects the fixed repository-relative path packages/hosted-local-harness/.tmp/cloudflared-linq-webhook.yml. A repository-root launch supplies .tmp/cloudflared-linq-webhook.yml instead. The same suite passes when launched from the package directory.

## Possible Solution

Derive the expected path from the fixture path and repository root, or anchor the fixture to the package directory.

## Minimal Reproducible Example

From the repository root, run pnpm exec vitest run --config packages/hosted-local-harness/vitest.config.ts --no-coverage packages/hosted-local-harness/test/dev-hosted-local/stack.test.ts. Compare with pnpm exec vitest run --config vitest.config.ts --no-coverage test/dev-hosted-local/stack.test.ts launched from packages/hosted-local-harness.

## Context

Focused dependency-upgrade verification needed a second launch from the package directory. The tunnel assertion is unrelated to the schema-sync change.
