---
title: 'Game account deletion query-plan proof depends on empty-table statistics'
severity: 'minor'
issue: 'cobuildwithus/murph#4702'
---

## Expected Behavior

The PostgreSQL account-deletion proof should reliably verify the paged note selector's usable actor/type index on an isolated migrated test database.

## Current Behavior

The full hosted Web suite can fail its exact index-name assertion in game-account-deletion-postgres.test.ts. With empty analyzed game tables, PostgreSQL chooses game_event_pkey and game_pkey. A later isolated rerun can choose game_event_actor_type_idx and pass. The SQL and assertion are unchanged on origin/main; extracting and executing that baseline SQL on empty analyzed tables reproduces the failure independently of application access changes.

## Possible Solution

Seed a bounded representative distribution and analyze it before checking the plan, or assert the intended index contract without requiring a cost-based planner choice on an empty table.

## Minimal Reproducible Example

On an isolated migrated local test database, run ANALYZE game_event and ANALYZE game. Execute the EXPLAIN query from the test named "uses the actor and type index for the paged note selector", with enable_seqscan disabled and two distinct synthetic actors. Compare the selected index names with the test's exact actor/type index assertion.

## Context

A complete serial hosted Web run exposed this failure while other task-specific fixture regressions were corrected. The test and production query were left unchanged; baseline reproduction isolates the test's dependence on database statistics.

The actual filtered test also fails in a clean detached origin/main checkout on a fresh migrated database after analyzing the empty game tables. The corresponding task changes are absent from that checkout.
