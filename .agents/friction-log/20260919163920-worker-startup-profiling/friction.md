---
title: 'Worker startup profiling attempts an unrelated container image build'
severity: 'minor'
---

## Expected Behavior

A documented Worker startup profiling command should measure the JavaScript entrypoint without requiring an assembled container image.

## Current Behavior

The pinned Wrangler startup checker invokes a deployment dry run that also builds declared containers. In a fresh checkout the build fails because the runner bundle has not been assembled. Passing the profiling config only to the outer check command does not forward it to the nested build.

## Possible Solution

Document a scratch config retaining the Worker entrypoint and compatibility flags while omitting container builds, and pass that config through the check command's build arguments. Keep production configuration unchanged.

## Minimal Reproducible Example

After installing dependencies in a fresh checkout, run `pnpm --dir apps/cloudflare exec wrangler check startup`. The container Dockerfile requires the absent `.deploy/runner-bundle` directory before profiling begins.

## Context

This blocks focused Worker initialization profiling behind unrelated container assembly.
