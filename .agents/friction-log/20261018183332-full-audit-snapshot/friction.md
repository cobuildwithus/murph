---
title: 'Full audit snapshot omits the Containers SDK patch used by readiness tests'
severity: 'minor'
---

## Expected Behavior

A guarded full source snapshot that includes Cloudflare readiness tests should also include the pinned Containers SDK patch those tests exercise, plus the lockfile and workspace patch mapping needed to reproduce that dependency.

## Current Behavior

The full ReviewGPT authoring ZIP contains the readiness test and dependency manifest but omits patches/@cloudflare__containers@0.3.7.patch. Running the included timing test against upstream 0.3.7 cannot reproduce the repository's bounded-probe behavior. The reviewer correctly reports incomplete patched-SDK verification.

## Minimal Reproducible Example

Create a normal full authoring snapshot with the canonical review configuration and tests enabled. Inspect the archive for apps/cloudflare/test/containers-helper-readiness.test.ts and patches/@cloudflare__containers@0.3.7.patch. The former is present and the latter is absent. Compare the included test's portProbeTimeoutMS option with the upstream SDK type and the tracked patch.

## Possible Solution

Include the tracked patch and its dependency mapping through the existing guarded context selection. A task can explicitly request those public files through COBUILD_AUDIT_CONTEXT_ALWAYS_PATHS without replacing the canonical packager.

## Context

The mismatch affects reproducibility of SDK-boundary telemetry and readiness reviews. No dependency change, production evidence, private content, or credentials are needed to reproduce it. Local verification remains authoritative for the patched SDK; this entry requests a packaging correction, not a relaxed review gate.
