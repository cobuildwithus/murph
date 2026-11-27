---
title: 'PostgreSQL proof runner has no documented way to run a chosen file set with its skipped-case receipt'
severity: 'minor'
---

## Expected Behavior

A focused change to one database owner (for example the Clinical Records suites) can run just the PostgreSQL files it touches through `scripts/run-postgres-tests.mjs` and still get the runner's receipt, which fails on skipped, pending, empty or missing files.

## Current Behavior

The documented entry point accepts only `--shard <index>/<count>`, and `--shard 1/1` runs every discovered PostgreSQL file. A plain `vitest run <file>` selects a subset but passes when every case is skipped (for example when `MURPH_TEST_POSTGRES_CONCURRENCY` is unset). The only subset path with the receipt is the internal worker mode: `MURPH_POSTGRES_PROOF_FILES='[...]' node scripts/run-postgres-tests.mjs --worker-files`, which `agent-docs/references/testing-ci-map.md` does not mention.

## Possible Solution

Document the worker mode as the local focused-proof command, or add an explicit local-only `--files` option that keeps the same receipt validation and stays rejected in CI shard mode.

## Minimal Reproducible Example

1. Prepare a migrated loopback `murph_test_<slug>` database.
2. Try to run two clinical PostgreSQL files through the runner: no documented option selects them.
3. Run them with `vitest run` instead and omit the opt-in flag: the run passes with every case skipped.

## Context

Hit while proving a Clinical Records reconnect fix that needed the six clinical PostgreSQL suites, with skipped selections rejected, without running the whole inventory.
