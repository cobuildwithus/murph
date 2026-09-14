---
title: 'Goal source hover proof reads an obsolete decoration style'
severity: 'minor'
---

## Expected Behavior

The viewport gate should verify that hovering a guide source changes only that source's visible style after its transition settles.

## Current Behavior

The source links use text-color transitions, while the gate reads text-decoration color immediately after hover. The check fails on the current component without an associated production change.

## Possible Solution

Target the existing source section, poll its text color, and retain the assertion that the adjacent source remains unchanged. This task includes that focused test correction.

## Minimal Reproducible Example

Run the viewport-overflow Playwright test matching `Goal guide source hover` against the current guide component.

## Context

An unrelated browser assertion blocked exact-head CI during deterministic Personal Patterns work. The corrected focused Chromium test passes.
