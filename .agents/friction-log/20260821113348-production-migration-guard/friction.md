---
title: 'Production migration guard carries ADD COLUMN checks across SQL statements'
severity: 'minor'
---

## Expected Behavior

The predeploy guard should classify a nullable ADD COLUMN statement independently from later SQL statements in the same migration.

## Current Behavior

The bounded ADD COLUMN pattern can match NOT NULL text in a following trigger function and reject a safe additive migration.

## Possible Solution

Evaluate incompatible patterns within SQL statement boundaries while preserving semicolons inside quoted values and dollar-quoted function bodies.

## Minimal Reproducible Example

Add a nullable text column, then define a dollar-quoted trigger function whose body checks another field with IS NOT NULL. The guard reports ADD COLUMN NOT NULL.

## Context

This false positive blocks release verification and candidate deployment for an otherwise additive migration.
