---
title: 'Game PostgreSQL fixtures leave lifecycle receipts that starve later drain proofs'
severity: 'minor'
issue: 'cobuildwithus/murph#4584'
---

## Expected Behavior

Game PostgreSQL suites should clean up the lifecycle receipts created by their synthetic games so a later suite in the same isolated database can exercise its own drain.

## Current Behavior

Running game-service, game-groups, game-change-cancelled and game-chat-access PostgreSQL proofs leaves awaiting-generation lifecycle receipts after game cleanup. A later missed-day suite reserves its own receipt successfully, but the production drain's one-row batch selects an older orphan kickoff instead. Serial file execution does not isolate this retained database state.

## Possible Solution

Track and remove each fixture game's lifecycle delivery hashes during cleanup, or allocate a separate database per suite that runs a global drain. Preserve the production drain's bounded selection.

## Minimal Reproducible Example

Run the existing game PostgreSQL suites against one session-owned migrated loopback murph_test_* database, then run game-group-missed-check-in-postgres.test.ts against it. Publication assertions fail while the new receipt remains awaiting_generation. Removing the prior session-created lifecycle receipts makes all 28 focused cases pass without a production change.

## Context

Found while verifying room/date missed-day publication. Only synthetic local database fixtures were involved. Keep these suites in separate clean database lanes until fixture ownership is repaired.
