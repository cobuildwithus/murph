# Experiment Lab Baseline Simplification

## Goal

Make lab-backed experiment setup treat baseline labs as measurement evidence, not as a required daily baseline window. Keep the durable model small by using existing run windows, measurement anchors, planned measurements, and adherence targets without adding new frontmatter concepts.

## Scope

- Experiment run/readiness behavior in query and browser replica.
- Experiment onboarding apply semantics for `baselineDays: 0`.
- CLI generated surface for measurement anchor/planned measurement options.
- Health Commons psyllium protocol defaults and copy that currently imply a 7-day LDL baseline.
- Focused tests proving lab-backed runs can be valid without a pre-intervention baseline window.

## Non-Goals

- No vault migration.
- No schema role rename from `baseline` / `followup`.
- No new persisted experiment state.
- No changes to unrelated hosted runner, assistant, or scheduled-log work already dirty in the checkout.

## Verification Plan

- Focused package tests for query, CLI, health-commons, and contracts if generated artifacts change.
- Package typechecks for touched packages.
- Completion audits required by repo workflow for health-data/product behavior changes.

## Status

- Implemented; finalization pending scoped finish/commit in a dirty shared worktree.
Status: completed
Updated: 2026-05-09
Completed: 2026-05-09
