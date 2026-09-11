---
title: 'ReviewGPT ZIP omits tracked CI authority outside workflows'
severity: 'minor'
---

## Expected Behavior

A guarded full review snapshot should include tracked CI authority files needed to trace the workflows in its change set, together with the pull request evidence template used by policy tests.

## Current Behavior

The CI scan in scripts/repo-tools.config.sh is limited to .github/workflows. An unchanged .github/native-hosted-e2e-controller.json and .github/pull_request_template.md are omitted even when reviewed native workflows read the controller policy before dispatch. The resulting snapshot cannot establish the exact configured native execution authority, and policy checks fail because their tracked inputs are missing.

## Possible Solution

Include the canonical CI authority and evidence-template files in the existing snapshot manifest and add a manifest coverage check. Preserve the current private-file and generated-artifact exclusions. The existing COBUILD_AUDIT_CONTEXT_ALWAYS_PATHS input can supply these exact tracked files for an individual review.

## Minimal Reproducible Example

On a clean task checkout whose patch changes native workflow execution but leaves its controller policy unchanged, generate the normal guarded full ReviewGPT ZIP. Inspect the archive for .github/native-hosted-e2e-controller.json and .github/pull_request_template.md. Both files exist at the checked commit but are absent from the default archive. Adding both relative paths through COBUILD_AUDIT_CONTEXT_ALWAYS_PATHS produces an archive containing bytes identical to that commit.

## Context

Testing and CI fidelity work required an additional review evidence round because the source archive omitted dispatch authority. The omission also prevents the included policy tests from running completely. This report concerns the public repository snapshot manifest, with no provider or private runtime evidence.
