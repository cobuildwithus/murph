---
title: 'Group override projection proof assumes PostgreSQL player row order'
severity: 'minor'
---

## Expected Behavior

The group terms round-trip test should verify retained and removed seat overrides independently of database row order.

## Current Behavior

The assertion expects tasks in seat order although the player relation query has no orderBy. A migrated local test database can return seats 1 and 0 in the other order, failing the otherwise correct projection.

## Minimal Reproducible Example

Run game-groups-postgres.test.ts against a migrated isolated loopback database. The removed-invitation override test may fail only on the order of its first two tasks.

## Possible Solution

Compare this unordered contract by seat in the test. Do not change production task ordering to satisfy an incidental assertion.

## Context

Found during group Prove it and Talk verification. The focused assertions now sort a copied task list by seat.
