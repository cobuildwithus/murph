---
title: 'Voice activity orb SVG precision mismatch warns during hydration'
severity: 'minor'
issue: 'cobuildwithus/murph#3051'
---

## Expected Behavior

A synthetic inline listening preview should hydrate without development-console attribute mismatch warnings.

## Current Behavior

The existing voice activity orb computes SVG circle coordinates with trigonometric functions. Server and Chromium calculations can serialize a sine-derived coordinate with a difference of about two quadrillionths, producing a React attribute hydration warning. The rendered study remains usable and no tree recovery was observed, but browser proof must distinguish this warning from functional failures.

## Possible Solution

Normalize the generated SVG coordinate precision at its existing owner so server and client serialize identical values.

## Minimal Reproducible Example

Render EnvironmentVoiceCapture with presentation="inline" and a synthetic listening preview in the repository smoke Web environment. Open the Health screenshot catalogue in Chromium, wait for hydration, and inspect development-console attribute mismatch diagnostics for VoiceActivityOrb circle coordinates.

## Context

Observed while checking independent Environment and Patterns catalogue rendering at phone and desktop widths. This report concerns the existing SVG coordinate generation; it does not request changes to interview behavior.
