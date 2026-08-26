---
title: 'Hosted-local Docker isolation drops macOS contexts and plugins'
severity: 'minor'
issue: 'cobuildwithus/murph#2328'
---

## Expected Behavior

The canonical hosted-local E2E command should preserve access to the selected
Docker Desktop or Colima engine and the installed Buildx plugin on supported
macOS developer hosts, start MinIO, and build the runner container.

## Current Behavior

E2E Docker isolation writes an empty temporary Docker config. That loses the
active non-default local engine context, so MinIO cannot connect to the Docker
API and the harness waits for the full readiness timeout before reporting only
an HTTP timeout. The existing preserve-config escape hatch restores the engine
context, but bypasses plugin discovery; on an Apple Silicon Homebrew setup,
Buildx exists in the standard Homebrew prefix yet Wrangler reports it missing.
Separately, the harness passes the macOS host UID and GID through Docker's
`--user` option. The pinned MinIO image then cannot write its bind-mounted
`/data` directory, while the same image becomes healthy when that Linux-specific
override is omitted.

## Possible Solution

Preserve the current local Docker context without copying registry auth into the
isolated config, include the Apple Silicon Homebrew CLI-plugin directory in
plugin discovery, and apply the host UID/GID override only on Linux. Add focused
platform and config-isolation tests while preserving normal cleanup and
readiness behavior.

## Minimal Reproducible Example

On a macOS host whose active Docker context is not the default Unix socket, run
the deterministic hosted-local foreground reply scenario. Observe that the
isolated config cannot connect to the Docker API and MinIO never reaches
`/minio/health/ready`. Enable the preserve-config escape hatch and observe that
Wrangler cannot find an installed Homebrew Buildx plugin. Run the pinned MinIO
image with the same bind mount and numeric `--user` option to reproduce the
`/data` file-access failure; omit that option and the readiness endpoint
succeeds.

## Context

This blocks production-shaped hosted-local E2E verification and turns a deterministic startup error into a five-minute timeout.
