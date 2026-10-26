---
title: 'Local live runner defaults to a binary rejected by canonical journeys'
severity: 'minor'
---

## Expected Behavior

The documented local live runner selects or identifies the native binary needed by the requested journey before launching it.

## Current Behavior

The default pinned npm Codex binary lacks `app-server --ignore-user-config`. Canonical live fixtures reject it at initialization with exit 64, before any provider request. The runner checks authentication but not this required capability.

## Minimal Reproducible Example

Run `pnpm test:assistant:live -- --test 'natural canary proposes a walking plan and persists it only after acceptance'` with the default pinned npm binary.

## Possible Solution

Document and provide a reproducible local build of the production native patch, and preflight the required binary capability for canonical journeys.

## Context

A full local model comparison needs the production-compatible binary to distinguish model behavior from startup failures.
