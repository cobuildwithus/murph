---
title: 'Shared prompt compaction left route-plan and skill-router fixtures stale'
severity: 'minor'
issue: 'cobuildwithus/murph#2826'
---

## Expected Behavior

Intentional shared prompt edits update their deterministic route-plan hashes and dedicated routing assertions in the same change.

## Current Behavior

A merged shared-router compaction updated analogous model-behavior assertions but omitted two assistant-engine fixtures, blocking unrelated PR release checks.

## Possible Solution

Align the three affected route-plan hashes and the signup-link routing substring with the intended prompt. Preserve the dedicated explicit-request authorization assertions.

## Minimal Reproducible Example

Run the assistant-engine Vitest cases named `characterizes complete route-plan outputs` and `routes explicit shareable-link requests` against main commit edbf122bae.

## Context

The failures reproduce without any assistant-engine production changes in the affected auth PR. The correction is test-only.
