---
title: 'One-time PR finalizer writes a migration before creating its directory'
severity: 'minor'
---

## Expected Behavior

The one-time PR finalizer should create every destination directory before
writing generated product files, then replace its workflow scaffold with the
generated changeset.

## Current Behavior

The Telegram phone-call finalizer writes the Prisma migration file before
creating the timestamped migration directory. The workflow exits with
`FileNotFoundError`, leaving the PR as only a self-finalizing workflow instead
of the intended product patch.

## Possible Solution

Create all parent directories before the first generated-file write, or
generate into a prepared temporary tree and verify it before applying the
patch.

## Minimal Reproducible Example

1. Run the one-time Telegram phone-call finalizer on a checkout without the
   target migration directory.
2. Let the generator reach its first migration-file write.
3. Observe that the workflow exits before product code, tests, or docs are
   materialized.

## Context

This left an open draft PR with a workflow-only changeset and required the
intended patch to be recovered manually.
