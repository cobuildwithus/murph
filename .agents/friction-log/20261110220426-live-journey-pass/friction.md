---
title: 'Live journey pass rates swing by batch, so separate base and head runs mislead'
severity: 'minor'
---

## Expected Behavior

A base-versus-head comparison of a live assistant journey tells me whether the head changed behavior.

## Current Behavior

The morning reminder reconciliation journey passed 5 of 6 runs on the default branch in one batch and 0 of 8 in the next batch on a commit that renders a byte-identical prompt with the same skills and tools. Comparing a base batch with a head batch run at another time pointed at the wrong cause three times. Only runs interleaved in one shuffled batch were comparable, and across those the same journey passes about 16 of 28 on the default branch.

Two more journeys cannot pass for reasons unrelated to the assistant: the ten-player combined-misses game journey stops before the model with "default_permissions requires a [permissions] table", and the symptom-save journey pins its prompt date months in the past while the Codex harness supplies the real date, so the saved note fails the Journal-day check.

## Possible Solution

Document in the live-proof order that base and head samples must be interleaved in one batch at a fixed worker count. Give the reconciliation journey assertions that tolerate one extra read, or split it into smaller journeys. Derive the symptom journey's dates from the real date. Fix the ten-player fixture's Codex config.

## Minimal Reproducible Example

Run the morning reminder reconciliation journey eight times on one commit, then eight more times an hour later with other live journeys running, and compare the pass counts.

## Context

Prompt and skill rewrite verified with a few hundred live runs per arm. About two hours went to bisecting a regression signal that was mostly batch noise.
