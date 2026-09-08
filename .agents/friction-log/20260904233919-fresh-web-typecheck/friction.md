---
title: 'Fresh Web typecheck requires an unprepared device-syncd service entrypoint'
severity: 'minor'
issue: 'cobuildwithus/murph#2936'
---

## Expected Behavior

The documented Web typecheck should resolve declared workspace imports after its ordinary preparation in a fresh sanctioned worktree.

## Current Behavior

A frozen filtered Web install followed by the ordinary Web typecheck reaches TypeScript but fails on the device-sync hosted-runtime authority test's public device-syncd/service import. The public export points to dist/service.d.ts, which has not been prepared; nearby device-sync imports have source aliases. The same failure reproduced in multiple fresh task worktrees.

## Possible Solution

Have the Web preparation owner build this declared dependency or provide the corresponding source alias consistently with adjacent entries.

## Minimal Reproducible Example

Create a fresh sanctioned worktree, install frozen Web workspace dependencies, and run pnpm --dir apps/web typecheck. Observe TS2307 for the declared service entrypoint. A normal device-syncd package build is the current next preparation step.

## Context

This adds an undocumented package-build prerequisite to unrelated Web verification. No product data or credentials are needed to reproduce it.
