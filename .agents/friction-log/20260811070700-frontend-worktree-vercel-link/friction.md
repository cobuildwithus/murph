---
title: 'Frontend-only worktree proof requires an unstated Vercel link'
severity: 'minor'
issue: 'cobuildwithus/murph#1714'
---

## Expected Behavior

The documented frontend-only worktree command should start the local Web app
after the caller supplies the required isolated port, build directory, and
database configuration.

## Current Behavior

Running the documented app-local `pnpm dev` command in a fresh sanctioned
worktree exits before Next starts because the worktree has no Vercel project
link metadata. The later auth-and-secret guidance mentions linking as one
possible source, but the frontend-only quick-start does not identify it as a
startup precondition.

## Possible Solution

State the Vercel link requirement directly beside the frontend-only command, or
provide a repository helper that validates the link and prints the exact safe
next step before invoking the app-local dev script.

## Minimal Reproducible Example

1. Create a fresh sanctioned task worktree.
2. Enter `apps/web` without adding ignored Vercel project metadata.
3. Run the documented frontend-only `pnpm dev` command with isolated port and
   Next build-directory settings.
4. Observe the Vercel CLI exit before the local Next process starts.

## Context

No environment values were written to repository files. Supplying ignored
project-link metadata and process-local development environment values allowed
the synthetic design study to render normally.
