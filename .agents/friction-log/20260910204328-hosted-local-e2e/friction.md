---
title: 'Hosted-local E2E seeds emit legacy snapshots after v2-only restore'
severity: 'minor'
---

## Expected Behavior

Hosted-local priority, ordering, and recovery fixtures should establish a valid encrypted workspace before exercising their assertions.

## Current Behavior

Several fixture seeds still call snapshotHostedExecutionContext, construct an artifact-backed bundle reference, and upload it through the legacy artifact test endpoint. The current restore owner rejects every non-v2 snapshot reference, so these tests cannot reach the behavior they intend to prove.

## Possible Solution

Share one test-only seed that composes the actual v2 archive, encryption, local object store, and checkpoint owners. Preserve production restore and publication fences.

## Minimal Reproducible Example

Create a synthetic initialized vault with the foreground-priority fixture seed. Its reference has a cloudflare-workspace-snapshots bundle key. Pass that workspace to the current restore owner; it rejects it because it requires a v2 snapshot reference.

## Context

This is a repository test-protocol mismatch found while checking cleanup rollout admission. The correction should preserve the existing priority and ordering assertions and prove a real encrypted archive restore.

The first v2 repair also requested runtime keys before a fresh member had an empty hosted workspace. The crypto-context route correctly returns 403 until that prerequisite exists. The follow-up provisions it through the existing testkit and workspace store before requesting keys; checkpoint publication still follows the encrypted upload and locator.

The Linux harness intentionally exposes MinIO on its explicitly marked Docker bridge gateway. The canonical R2 parser validates that endpoint, but a redundant fixture-only literal-loopback check rejected it. Reuse the canonical validation and retain the separate Web loopback requirement. The retired shell-prewarm route's negative test also used the harness helper that throws on HTTP errors, preventing its expected 404 assertion; use the same authenticated fetch directly for this negative response.

The shared fixture also encoded its random archive IV as ordinary base64. Values containing a slash or plus sign fail the canonical checkpoint parser, which requires base64url. Direct decryption accepted both spellings and hid this mismatch. Encode the fixture IV as base64url and pass an adversarial deterministic IV through the real snapshot-ref parser before the existing encrypted upload and restore proof. The S3 checksum remains ordinary base64, as its separate wire contract requires.
