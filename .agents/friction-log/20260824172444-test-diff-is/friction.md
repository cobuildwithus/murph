---
title: 'test:diff is blocked by unrelated workspace-boundary failures'
severity: 'minor'
issue: 'cobuildwithus/murph#2725'
---

## Expected Behavior

The diff verification lane should report failures caused by the current patch, or provide a usable path to isolate known baseline failures.

## Current Behavior

pnpm test:diff stops on two workspace-boundary violations that also fail on the clean main checkout. The failures are in the CLI Junction body-composition test and the vault-usecases Junction workout-features test. This prevents the lane from reaching its remaining checks for an unrelated feature.

## Possible Solution

Fix the two baseline imports, or let the dispatcher record known base failures and continue with checks that can still validate the current diff.

## Minimal Reproducible Example

Run pnpm verify:workspace-boundaries on the clean main checkout. The same two violations appear before applying a task patch.

## Context

This task required focused package tests, typechecks, package-shape proof, and docs checks as a substitute for the blocked umbrella lane.
