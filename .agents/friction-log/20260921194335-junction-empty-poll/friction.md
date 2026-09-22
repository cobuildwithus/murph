---
title: 'Junction empty-poll replay test still requires retired device audit'
severity: 'minor'
---

## Expected Behavior

The importer replay test should follow the canonical automatic device publication contract: one durable integration receipt and a null auditPath, while identical empty polls remain no-ops and later records are admitted.

## Current Behavior

After the single-receipt change, the Junction empty-poll replay test still requires a separate success audit. The deterministic assertion fails in the platform-a release shard and blocks otherwise unrelated runtime changes.

## Possible Solution

Assert auditPath is null and compare the integration receipt across replay. The task applies this isolated assertion correction; product code and receipt behavior remain unchanged.

## Minimal Reproducible Example

Run pnpm exec vitest run --config packages/importers/vitest.config.ts --no-coverage packages/importers/test/device-providers-junction.test.ts -t 'Junction repeated empty polls persist once and still admit later records' on the single-receipt main baseline before the correction.

## Context

Discovered while completing checkpoint-preemption and mailbox-timing verification. The importer and core production files match the merged main baseline. The failure is reproducible with the existing synthetic fixture.
