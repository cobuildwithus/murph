---
title: 'Hosted Web test runner silently omits explicitly requested database tests'
severity: 'minor'
issue: 'cobuildwithus/murph#3137'
---

## Expected Behavior

A focused command naming both a regular test and a database test should execute both, or explicitly reject the unsupported database file and name its correct entrypoint.

## Current Behavior

The hosted Web test:prepared wrapper uses the workspace configuration, which excludes every *.db.test.ts file. A mixed request exits successfully after running only the regular tests and does not identify the omitted database file. This can give a misleading impression that an affected database owner was verified.

## Minimal Reproducible Example

Run `pnpm --dir apps/web test:prepared test/action-approval-decision-route.test.ts test/action-approvals.db.test.ts` from a prepared checkout. The report contains one test file although two existing files were explicitly requested. The database file is admitted through `apps/web/vitest.config.ts` instead.

## Context

Focused authentication migration verification needed an additional inventory check and a separate database invocation. No product or production evidence is included.
