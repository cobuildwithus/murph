---
title: 'ReviewGPT visual audits exclude exact-head screenshot bytes'
severity: 'minor'
---

## Expected Behavior

A ReviewGPT audit package for an iOS UI pull request should include the changed exact-head synthetic screenshots cited by the pull request, or provide a documented safe companion-artifact route, so the reviewer can inspect clipping, contrast, hierarchy, and visual polish.

## Current Behavior

The guarded snapshot permits only UTF-8 text. Changed PNG review evidence appears only as binary diff markers and immutable blob identities, so a visual audit can verify source and screenshot identity but cannot inspect the pixels. The workflow still asks reviewers to evaluate visual proof, which can overstate what the packaged evidence supports.

On a head with several larger PNGs, the packager's strict `git archive | tar`
pipeline can also exit `141` after extraction completes because the producer
observes a closed pipe. This prevents the guarded review from starting even
though the extracted tree is complete.

## Possible Solution

Add a bounded, privacy-reviewed binary evidence manifest for changed files under the durable iOS review-evidence directory, with exact-head blob verification and existing identifier/secret gates, or document a first-class companion attachment command.

Make archive extraction validate both process statuses while accepting the
producer's post-success SIGPIPE only after the consumer exits successfully and
the existing blob-by-blob verification proves the extracted bytes.

## Minimal Reproducible Example

1. Change a SwiftUI view and add a synthetic PNG under the durable review-evidence directory.
2. Open a pull request that embeds the exact-head raw image.
3. Run the configured ReviewGPT audit.
4. Inspect the guarded ZIP: it contains the PNG path and binary diff marker, but not the PNG bytes.
5. With enough binary evidence on the head, observe that the guarded packager
   may exit `141` at archive extraction before it creates a ZIP.

## Context

This blocks pixel-level ReviewGPT confirmation for iOS layout, Dynamic Type, dark mode, and interaction-hierarchy audits and forces an ad hoc companion visual artifact.
