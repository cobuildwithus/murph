---
title: 'Junction empty-poll replay test requires a retired audit receipt'
severity: 'minor'
---

## Expected Behavior

The importer replay proof should validate the durable ingest receipt and unchanged replay bytes under the single-receipt device import contract.

## Current Behavior

After the single-import-receipt change, the empty-poll importer test still requires a non-null auditPath. The canonical importer intentionally returns null, so release platform coverage fails before testing replay preservation.

## Minimal Reproducible Example

Run `pnpm --dir packages/importers exec vitest run test/device-providers-junction.test.ts -t "Junction repeated empty polls persist once and still admit later records"` with the existing synthetic fixture.

## Context

A base reconciliation exposed the stale cross-package expectation in an unrelated prompt PR. Update the assertion to expect no duplicate audit and retain the ingest-receipt byte comparison.
