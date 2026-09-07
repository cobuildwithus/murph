---
title: 'Hosted-local smoke polling ends before standby preparation can finish'
severity: 'minor'
---

## Expected Behavior

Hosted-local E2E setup lets the existing smoke owner observe a valid standby preparation within its supported readiness window, while preserving explicit caller limits and failure deadlines.

## Current Behavior

The local harness replaces the smoke owner's attempt budget with 30 one-second polls. Standby preparation allows 75 seconds, including container startup and content-free Codex CLI proof. A valid preparation that completes after 30 seconds is abandoned before the readiness owner finishes, and no scenario tests run.

## Minimal Reproducible Example

Have the synthetic smoke endpoint return standby-not-ready responses for 45 polling intervals and then a valid managed-container proof. The real smoke client fails under the harness's 30-attempt override and succeeds under its canonical default. The harness composition test observes the premature override even when the caller supplies no limit.

## Context

This prevents hosted foreground integration checks from reaching their scenario assertions. Preserve readiness checks and reuse the canonical smoke policy instead of shortening it in local setup.
