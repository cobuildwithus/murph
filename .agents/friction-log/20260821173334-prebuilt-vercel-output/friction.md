---
title: 'Prebuilt Vercel output omits Workflow queue consumer triggers'
severity: 'minor'
issue: 'cobuildwithus/murph#2149'
---

## Expected Behavior

A supported prebuilt hosted-web deployment should include the Workflow SDK queue-consumer metadata required by every generated Step and Flow handler.

## Current Behavior

The local production prebuild generated the Step and Flow routes as links to one shared Next.js function bundle, but that bundle's `.vc-config.json` had no `experimentalTriggers`. Vercel accepted the upload and then rejected the deployment because Workflow handlers were present without a queue consumer. Adding the SDK's Step and Flow queue triggers to the ignored shared function metadata allowed the exact same prebuilt output to deploy.

## Possible Solution

Have the Workflow/Next build integration preserve both queue triggers when Vercel deduplicates handler routes into one function bundle, and add a prebuilt-output assertion before upload.

## Minimal Reproducible Example

1. Run the repository's supported local production prebuild for `apps/web`.
2. Inspect the generated Step and Flow `.vc-config.json` files under `.vercel/output/functions/.well-known/workflow/v1/`.
3. Confirm the routes resolve to the same function bundle and no `experimentalTriggers` are present.
4. Upload with `vercel deploy --prebuilt`; deployment validation reports Workflow handlers without a queue consumer.

## Context

This blocked a reviewer preview after the ordinary remote build had already exhausted its memory budget. The workaround was confined to ignored deployment output and did not change application source.
