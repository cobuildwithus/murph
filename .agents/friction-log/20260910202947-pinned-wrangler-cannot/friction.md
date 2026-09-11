---
title: 'Pinned Wrangler cannot parse the namespace bootstrap rollout flag'
severity: 'minor'
issue: 'cobuildwithus/murph#3231'
---

## Expected Behavior

The repository's direct Wrangler dependency supports the no-container-update option required by namespace bootstrap.

## Current Behavior

The bootstrap wrapper passes `--containers-rollout=none`, but the locked direct Wrangler version predates that option. Mocked wrapper tests accept the argument without exercising CLI parsing.

## Possible Solution

Use the first supported Wrangler release, preserve existing dependency patches and security overrides, and exercise the app-resolved CLI with a synthetic dry-run config.

## Minimal Reproducible Example

With the former lockfile, invoke the app-resolved Wrangler with `deploy --dry-run --containers-rollout=none` and a synthetic Worker config. Argument validation rejects the rollout value before deploy preparation.

## Context

This is a repository dependency and proof mismatch. A secret-free CLI dry-run can detect it without accessing an account or starting Docker.
