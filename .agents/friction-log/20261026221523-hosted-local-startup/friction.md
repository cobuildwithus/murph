---
title: 'Hosted-local startup diagnostics discard the failing process behind noisy siblings'
severity: 'minor'
issue: 'cobuildwithus/murph#4389'
---

## Expected Behavior

A failed hosted-local startup preserves the failing child's bounded, redacted diagnostic output alongside other process tails.

## Current Behavior

The harness bounds each child stream, combines those streams, then keeps only the last 2,000 characters of the combined text. Later healthy-process output can erase the actual Worker startup error. Deployment E2E failures then report only that the child exited.

## Minimal Reproducible Example

Make the synthetic Cloudflare child exit with a short diagnostic, then give a healthy Web sibling more than 2,000 characters of startup output. Await stack readiness and inspect the rejection: the Cloudflare diagnostic is missing.

## Possible Solution

Keep the existing per-stream bounds without applying a second global tail that drops earlier children. Extend the existing startup-failure test with a noisy sibling.

## Context

This prevents diagnosis of protected deployment E2E failures before any production mutation.
