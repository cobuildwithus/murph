---
title: 'Developer entrypoints duplicate and contradict completion instructions'
severity: 'minor'
issue: 'cobuildwithus/murph#2830'
---

## Expected Behavior

Developer entrypoints route to one current completion workflow and load only relevant context.

## Current Behavior

CLAUDE.md specifies killing and relaunching stalled review jobs while the review owner requires one capture owner and exact-thread recovery. The index repeats extensive domain contracts, and the entrypoints require reading unrelated architecture before text-only work. Some workflow tests assert exact prose and whitespace rather than executable behavior.

## Possible Solution

Keep one workflow owner, a short discovery index, and task-specific reads. Remove superseded instructions and prose-only assertions while preserving executable workflow tests.

## Minimal Reproducible Example

Compare CLAUDE.md review retry instructions with agent-docs/operations/pr-reviewgpt-loop.md wait ownership, and compare AGENTS.md required reads with the docs-only task class. Inspect the documentation assertions in scripts/developer-workflow-entrypoints.test.ts, packages/cli/test/release-script-coverage-audit.test.ts, and apps/web/test/production-migration-guard.test.ts. They also pin old model names and require timeout defaults in duplicate documents.

## Context

Conflicting entrypoints can cause duplicate external reviews, unnecessary blocking, and excessive context loading.
