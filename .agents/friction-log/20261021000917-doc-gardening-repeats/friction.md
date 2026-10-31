---
title: 'Doc gardening repeats shell index comparisons for every historical document'
severity: 'minor'
issue: 'cobuildwithus/murph#4265'
---

## Expected Behavior

The documentation inventory and index check should preserve its findings without spending tens of seconds repeatedly comparing each document with every index row.

## Current Behavior

The wrapper generates an upstream report with nested Bash loops before filtering out untracked and completed-plan paths. A clean source checkout with 6,592 tracked documentation paths took 36.57 seconds for this command alone.

## Possible Solution

Generate the same inventory and findings with Node sets and directory-prefix matching, preserving discovery, sorting, tracked-file filtering, diagnostic output, and failure status.

## Minimal Reproducible Example

Install the frozen dependencies, then time `bash scripts/doc-gardening.sh --fail-on-issues` against the same source twice and compare the generated inventory and report bytes.

## Context

This command runs in the required release build/typecheck CI job. Command timing is not a measurement of total workflow or billing savings.
