---
title: 'Worker secret cleanup dry-run omits required-secret declarations'
severity: 'minor'
---

## Expected Behavior

The offline Worker secret-retirement fixture should include the canonical `secrets.required` declaration and prove that the exact pinned Wrangler accepts the generated upload config with synchronization disabled, empty, partial, and full.

## Current Behavior

The original fixture omitted `secrets.required`. It passed even though Wrangler validates duplicate names across Secret and Unsafe Metadata bindings before applying `--secrets-file`. Adding a required declaration for a retained inherited key reproduces the rejection in every synchronization mode.

## Possible Solution

Use production-shaped required declarations in the real-Wrangler regression matrix. Validate each required key against the retained baseline plus supplied payload, omit supplied names from inheritance, and remove only inherited names from required declarations in the temporary upload config.

## Minimal Reproducible Example

Create a synthetic Worker config with `secrets.required: ["OPENAI_API_KEY"]` and `unsafe.bindings: [{name: "OPENAI_API_KEY", type: "inherit", version_id: "synthetic-baseline"}]`. Run pinned Wrangler 4.93 `versions upload --dry-run`. Config validation rejects the duplicate name before any upload or payload overlay.

## Context

This is a repository proof-fixture gap in `apps/cloudflare/test/deploy-retired-inference-secrets.test.ts`. The correction preserves the canonical generated artifact, optional and crypto secrets, explicit baseline inheritance, rotations, and preactivation inventory checks.
