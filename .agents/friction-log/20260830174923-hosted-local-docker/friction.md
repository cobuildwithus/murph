---
title: 'Hosted-local Docker plugin discovery accepts directories without Buildx'
severity: 'minor'
---

## Expected Behavior

Hosted-local should select a Docker CLI plugin directory only when it contains an executable `docker-buildx`, and doctor should fail early with a clear prerequisite error when Buildx is unavailable.

## Current Behavior

The harness selects the first existing candidate directory. An empty earlier candidate hides a later valid Homebrew candidate, so Wrangler fails during container image preparation because its Buildx-only flags are parsed by the legacy builder. Startup cleanup then removes the isolated Docker config before Docker diagnostics run, which can replace the useful build failure with misleading socket and plugin errors.

## Possible Solution

Require an executable `docker-buildx` when selecting a plugin directory, include `docker buildx version` in doctor, and collect Docker diagnostics before removing the isolated Docker config.

## Minimal Reproducible Example

Create an empty first plugin candidate and a later candidate containing an executable synthetic `docker-buildx`. Start a hosted-local Containers scenario. The harness selects the empty directory and Wrangler exits before workerd starts, even though a valid later candidate exists.

## Context

A production-shaped cold-start E2E required an explicit `DOCKER_CONFIG` workaround despite Buildx already being installed. The failure occurred before the application readiness path and obscured unrelated performance verification.
