---
title: 'Hosted runtime review cannot attach both guarded repository snapshots'
severity: 'minor'
---

## Expected Behavior

The hosted-runtime final review route can stage exact guarded public runtime and private deployment-consumer snapshots together, preserving each repository's clean-head preflight, metadata, and privacy checks.

## Current Behavior

Each repository's canonical ReviewGPT wrapper attaches only its own guarded ZIP. A deployment-contract review cannot inspect the companion renderer and environment owner from that packet and returns an evidence-gap result. The installed wrapper exposes no additional-attachment option, so completing the required cross-owner review needs direct orchestration through the existing canonical draft driver with both untouched guarded ZIPs.

## Minimal Reproducible Example

1. Prepare clean pushed public-runtime and private deployment-consumer PRs that change one shared environment contract.
2. Run the private final review using its ordinary guarded packet.
3. Observe that the packet has the consumer but not the exact companion producer source.
4. Inspect the normal wrapper's attachment options; there is no way to add the second canonical ZIP while keeping the existing first packet.

## Context

This is a gap in the repository's required hosted-runtime review workflow. A supported companion-snapshot staging seam should retain exact revision metadata, the managed browser lane, a single waited completion owner, and the normal model/response validation. It must not replace guarded snapshots with raw checkout archives or copied source trees.
