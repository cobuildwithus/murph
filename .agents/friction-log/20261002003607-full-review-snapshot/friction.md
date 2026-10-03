---
title: 'Full review snapshot omits the native Codex build patch'
severity: 'minor'
issue: 'cobuildwithus/murph#3985'
---

## Expected Behavior

The guarded full review snapshot includes the native Codex patch copied by the hosted runner Dockerfile, even when the patch is unchanged in the PR.

## Current Behavior

Full-snapshot roots and mandatory paths include the runner Dockerfiles but omit the patches directory. A version-only Codex upgrade therefore provides the patch application command without its production implementation.

## Minimal Reproducible Example

Package a clean PR that changes the Codex version pins while leaving patches/codex-public-live.patch unchanged. Inspect the generated ZIP: the runner base Dockerfile is present and the native patch is absent.

## Possible Solution

Include the exact native patch in the existing mandatory-path list and extend the archive-selection regression test to exercise an unchanged patch.

## Context

Missing native build source prevents a complete runtime dependency review. This is a snapshot-selection defect, not a missing production file.
