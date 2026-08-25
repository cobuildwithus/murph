---
title: 'Private runner composition invalidates public release provenance'
severity: 'major'
issue: 'cobuildwithus/murph#2284'
---

## Expected Behavior

A protected deployment may compose reviewed private runtime assets onto an exact public checkout while retaining the public base commit and exact composed bundle fingerprints.

## Current Behavior

Runner bundle assembly treats every tracked overlay as missing public release provenance. Hosted-local startup then rejects the generated manifest before any scenario can run, and production deploy validation cannot accept the composed bundle.

## Possible Solution

Define the release SHA as the checked-out public base commit and keep the existing source and bundle fingerprints as the exact composed-artifact identity.

## Minimal Reproducible Example

Create a Git repository with one committed file, record HEAD, modify that tracked file to model a reviewed overlay, assemble the runner manifest, and run deploy smoke. The manifest contains null release provenance even though the public base commit remains known.

## Context

The failure blocks every deployment lane that composes private runner assets before bundle assembly.
