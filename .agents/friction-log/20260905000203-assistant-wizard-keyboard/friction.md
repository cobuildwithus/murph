---
title: 'Assistant wizard keyboard test races rendered provider selection'
severity: 'minor'
---

## Expected Behavior

The Venice wizard journey waits for each visible provider selection before sending the next key.

## Current Behavior

Under composed acceptance load, the test can save the preceding local-model option. The shared input helper waits only ten milliseconds; its cumulative output already contains the Venice label before that option becomes active. The same test file passes when run alone.

## Possible Solution

Wait for and assert the active selection marker after each navigation key before confirming the provider.

## Minimal Reproducible Example

Run the full acceptance composition. The Venice journey sends two down-arrow keys and Enter through the fixed-delay TTY helper; the final saved provider can still be the local model.

## Context

This makes repository acceptance sensitive to renderer scheduling despite the isolated wizard journey passing.
