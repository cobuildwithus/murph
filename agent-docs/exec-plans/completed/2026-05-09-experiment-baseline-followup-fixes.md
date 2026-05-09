# Experiment Baseline Follow-Up Fixes

## Goal

Close final review blockers from the lab-backed baseline simplification: make `baselineDays: 0` an atomic clear operation and prevent mixed point-lab/daily metric comparisons.

## Scope

- Experiment onboarding run-window patch semantics.
- Query and browser replica metric window selection/completeness.
- Focused regression tests for explicit baseline clears, incomplete point plans, and point-lab outcome readiness.

## Non-Goals

- No schema migration.
- No broad browser replica redesign.
- No changes to unrelated dirty hosted, assistant, device-sync, or scheduled-log work.

## Verification Plan

- Focused query/browser, CLI, vault-usecases tests.
- Typecheck touched packages.
- Final scoped review before finish.

## Status

- Implemented and reviewed; finalizing scoped commit.
Status: completed
Updated: 2026-05-09
Completed: 2026-05-09
