---
title: 'Hosted-local E2E requests a Prisma reset on freshly created databases'
severity: 'minor'
---

## Expected Behavior

A hosted-local scenario should initialize the schema in its new, empty PostgreSQL database with a plain Prisma schema push.

## Current Behavior

The full-stack scenario helper sets the force-reset option even when it has just created the database. Prisma's agent safeguard rejects the resulting command before the scenario reaches its runtime assertions.

## Possible Solution

Choose schema setup from the database lease. Run a plain schema push for a freshly created database and reserve reset handling for explicitly reused databases.

## Minimal Reproducible Example

Run `pnpm hosted-local e2e idle-checkpoint-deferred-progress --profile e2e:stub` from Codex with no database override. The scenario creates an empty database. During stack startup, `prisma db push --force-reset` triggers the destructive-action safeguard. A plain `prisma db push` succeeds on a fresh database.

## Context

This forces a separate schema initialization and database lease for each focused checkpoint scenario.
