---
title: 'Postgres db-push proof omits handwritten check constraints'
severity: 'minor'
---

## Problem
The documented PostgreSQL proof lane prepares its schema with Prisma db push. Handwritten CHECK constraints in migrations are absent from that schema, so a new game lifecycle status can pass persistence tests while the migrated schema rejects it.

## Reproduction
Create a fresh isolated test database with prisma db push, then inspect the game table constraints. The game_status_check and game_live_roster_check constraints from the weekly game migration are missing. A migration-backed test database still enforces the original accepted statuses.

## Workaround
Apply the task-owned constraint migration to the isolated proof database and rerun the affected persistence suite. Keep the migration in the change.

## Suggested improvement
Have the database proof owner install migration-owned constraints or exercise a migration-prepared schema for affected integrity boundaries.
