---
title: 'Required Web CI fails before tests when PostgreSQL image pulls are rate limited'
severity: 'minor'
issue: 'cobuildwithus/murph#3898'
---

## Expected Behavior

Required Web and PostgreSQL proof should initialize their declared database service reliably on hosted CI runners, so the candidate's code can be tested.

## Current Behavior

Independent Web and PostgreSQL matrix jobs can fail during container initialization because the registry rejects the PostgreSQL image pull for rate limiting. No test process starts, yet the aggregate release gate fails. The scheduled live billing lane can encounter the same initialization boundary.

## Possible Solution

Investigate the existing CI database image owner for an approved reliable pull source or existing authenticated registry path. Preserve the current database version, service semantics and required checks; do not bypass the failing proof.

## Minimal Reproducible Example

Run the existing Host Support workflow on an unchanged synthetic branch while the shared hosted-runner registry pull allowance is exhausted. Inspect the completed job's container-initialization step through the job-log API; the failure precedes repository test execution. A job-log read is available before the whole workflow completes.

## Context

Observed during verification of a telemetry-only route change. Both CLI matrices and the hermetic billing boundary pass independently. A later exact-head retry is needed to distinguish recovery of the external pull boundary from any test failure.

## Resolution

The three public CI service references now use the official upstream PostgreSQL
17 image. Public manifests matched at verification time. Existing service
configuration, health probes, workflow permissions and required gates are
preserved; source-owner policy tests cover all affected service references.
