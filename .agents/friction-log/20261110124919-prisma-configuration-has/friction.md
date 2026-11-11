---
title: 'Prisma configuration has no option to skip local env files'
severity: 'minor'
issue: 'cobuildwithus/murph#4800'
---

## Expected Behavior

Focused local schema generation, validation and migrated PostgreSQL tests can run with only explicitly supplied synthetic configuration when a task prohibits reading dotenv files.

## Current Behavior

The Web Prisma config unconditionally calls `process.loadEnvFile` for existing local dotenv files. Supplying a synthetic `DATABASE_URL` does not prevent those reads. An isolated temporary Prisma config is required to honor a no-dotenv verification boundary.

## Possible Solution

Add an explicit no-dotenv mode to the existing Prisma config and document its focused verification commands.

## Minimal Reproducible Example

Inspect `apps/web/prisma.config.ts`: its dotenv loop runs for schema generation and validation as well as migration commands, without an opt-out.

## Context

Consumer-only routing work needs local Prisma generation and migrated PostgreSQL proof without loading external credentials.
