---
title: 'Development CLI evaluation forwards the argument separator to Wrangler'
severity: 'minor'
---

## Expected Behavior

The repository CLI evaluation helper should pass the requested command and flags to an exact registry CLI without changing the workspace dependency graph.

## Current Behavior

Evaluating Wrangler deployment help through the helper fails because the extra argument separator reaches Wrangler, which treats the command and help flag as positional arguments. Running the same pinned pnpm dlx invocation without that separator succeeds.

## Possible Solution

Check the pinned pnpm dlx argument forwarding contract and omit the separator before CLI arguments if it is forwarded literally.

## Minimal Reproducible Example

From apps/cloudflare, run ../../scripts/evaluate-dev-cli wrangler@4.93.0 -- deploy --help. Compare it with pnpm --config.ignore-scripts=true --config.registry=https://registry.npmjs.org/ dlx wrangler@4.93.0 deploy --help.

## Context

This blocks a read-only deployment CLI compatibility evaluation and requires reproducing the helper's policy-preserving command manually.
