---
title: 'Vercel Ready deployment can leave production domains on previous build'
severity: 'major'
---

## Expected Behavior

After the protected Web deployment reports production Ready, every configured production custom domain should resolve to that exact deployment, or the deploy workflow should fail before reporting completion.

## Current Behavior

A merged Web deployment reached Ready and received the project production aliases, but the primary custom domain remained pinned to the prior deployment. Scheduled production callbacks therefore continued executing old code until an explicit Vercel promotion moved the production domain set.

## Possible Solution

Make the deploy workflow perform and verify an exact deployment promotion. Assert the deployment id behind every production custom domain, including the callback host, before the workflow reports success.

## Minimal Reproducible Example

1. Merge a Web change and wait for its production deployment to report Ready.
2. Inspect the new deployment aliases and the deployment serving the primary custom domain.
3. Observe the project aliases on the new deployment while the custom domain still serves the prior deployment.
4. Promote the exact new deployment and observe the custom domain move.

## Context

This masked an urgent runtime correction: build and project-alias checks were green while minute-scheduled production traffic continued hitting old code. No environment variables or secret values were involved.
