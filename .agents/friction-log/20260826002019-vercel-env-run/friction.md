---
title: 'Vercel env run supplies empty protected production database variables'
severity: 'minor'
issue: 'cobuildwithus/murph#2337'
---

## Expected Behavior

Repository operator instructions that use `vercel env run --environment=production` should provide the required database binding to the child command, or route the command through the existing protected production workflow.

## Current Behavior

The Vercel project lists `DATABASE_URL` and `DIRECT_DATABASE_URL`, but an authenticated `vercel env run` child receives both names with empty values. Database-backed maintenance scripts therefore fail before even a dry-run, while their repository documentation presents the local command as executable.

## Possible Solution

Use the existing GitHub `production` environment as the database-backed operator boundary, or provide one reusable protected maintenance entrypoint and make the docs name that owner.

## Minimal Reproducible Example

From an authenticated checkout linked to a synthetic Vercel project with protected database variables, run a child process through `vercel env run -e production` that reports only whether each required value is non-empty. Both report false even though the variable names are listed for Production.

## Context

This blocked a bounded, aggregate-only production backfill after the replacement application build and deployment gate were already green. No credentials or row data are needed to reproduce the command-path mismatch.
