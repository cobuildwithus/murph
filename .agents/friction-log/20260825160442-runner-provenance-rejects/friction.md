---
title: 'Runner provenance rejects intentional private deployment overlays'
severity: 'minor'
---

## Expected Behavior

A protected cross-repository deployment can identify the exact public commit while intentionally materializing private runtime assets into the checkout before bundle assembly.

## Current Behavior

The bundle provenance resolver treats every dirty checkout as lacking release provenance. The required private asset overlay therefore produces a null release SHA, causing both hosted-local gates and the production deploy artifact validator to fail before rollout.

## Possible Solution

Let the protected workflow pass its already-resolved public commit SHA into bundle assembly, verify that it exactly matches checked-out HEAD, and retain the source and final-bundle fingerprints for assembled-content identity.

## Minimal Reproducible Example

1. Check out an exact public commit.
2. Materialize an intentional deployment-only asset under a tracked package path.
3. Assemble the runner bundle.
4. Observe that the manifest records no release SHA and is rejected by deployment validation.

## Context

This blocks the canonical Cloudflare deployment workflow after release-provenance validation was added.
