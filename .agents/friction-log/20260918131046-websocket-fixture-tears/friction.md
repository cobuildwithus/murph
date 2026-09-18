---
title: 'WebSocket fixture tears down before final diagnostic write settles'
severity: 'minor'
---

## Expected Behavior

The real-Worker WebSocket fixture waits for its own scheduled diagnostic writes before completing, so native teardown errors do not obscure transport regressions.

## Current Behavior

The explicit-context native-memory accounting fixture closes both socket legs but leaves the final diagnostic write pending. A passing isolated run can emit an uncaught native internal error during teardown.

## Minimal Reproducible Example

Run the existing synthetic fixture:
`pnpm exec vitest run --config apps/cloudflare/vitest.workers.config.ts --no-coverage apps/cloudflare/test/workers/runner-egress-codex-memory-websocket.test.ts -t 'routes marked upgrades'`.

Awaiting the fixture's collected `waitUntilPromises` after both close assertions removes the teardown error without changing transport behavior.

## Context

Runtime error investigation needs test output that distinguishes actual relay failure from incomplete fixture teardown. The fixture already owns and captures the pending promises.
