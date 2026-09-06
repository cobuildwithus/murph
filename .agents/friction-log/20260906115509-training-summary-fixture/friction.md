---
title: 'Training summary fixture ages out of the real clock''s lookback window'
severity: 'minor'
---

## Expected Behavior

The canonical Training summary test should derive the same summary from its fixed synthetic workout dates on every execution date.

## Current Behavior

The test calls selectBrowserVaultTraining without its optional clock. Its August 7 and August 9 fixtures are evaluated against the real current date and the 30-day summary window. On September 6, the first session falls outside that window and the unchanged fixture fails locally and in the hosted-Web CI shard.

## Possible Solution

Pass a fixed now and UTC timezone matching the fixture's generatedAt to the existing selector. The task applies this test-only correction without changing production behavior.

## Minimal Reproducible Example

Run pnpm test:prepared browser-training-view.test.ts from apps/web with the unpinned fixture when the real date is September 6, 2026. The canonical sessions test expects two summary workouts and receives one.

## Context

This pre-existing date dependency blocked CI for an unrelated operational diagnostics patch. The production selector and failing fixture were unchanged from that patch's base.
