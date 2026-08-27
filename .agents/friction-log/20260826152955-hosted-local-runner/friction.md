---
title: 'Hosted-local runner bundle manifest generation can hang past its fixed timeout'
severity: 'minor'
issue: 'cobuildwithus/murph#2421'
---

## Expected Behavior

The hosted-local runner bundle build should generate the assistant CLI surface manifest and exit within its bounded preparation step.

## Current Behavior

Runner bundle preparation repeatedly reaches the 60-second assistant CLI manifest timeout before any E2E test starts. Running the same source CLI manifest command directly also remains alive beyond the timeout instead of exiting.

## Possible Solution

Make the full-manifest command close any remaining local handles after writing its result, or let bundle generation consume the already-built workspace CLI artifact through the existing launcher boundary.

## Minimal Reproducible Example

1. Run `pnpm --dir apps/cloudflare runner:bundle:hosted-local` in a prepared checkout.
2. Observe the assistant-engine build invoke the full CLI manifest command.
3. Observe bundle preparation fail at the fixed manifest timeout before the hosted-local scenario starts.

## Context

This blocks an otherwise isolated hosted-local Linq E2E before the product journey runs. The available workaround is the existing `--no-bundle` mode when a current validated runner bundle already exists.
