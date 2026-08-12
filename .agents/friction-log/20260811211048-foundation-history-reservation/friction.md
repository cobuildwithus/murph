---
title: 'Foundation history reservation test duplicates child-admitted resources'
severity: 'minor'
---

## Expected Behavior

The fixed v1 coverage-coordinate assertion remains stable when a stacked child branch admits one of the already-reserved resources.

## Current Behavior

The test builds its expected fixed reservation list by spreading the current admitted extended-history list and then appending reserved resources. On a child branch where a reserved resource is now admitted, that resource appears twice in the expected array and the otherwise-correct reservation fails.

## Possible Solution

Pin the fixed v1 reservation order as a literal list, then assert separately that every currently admitted extended-history resource has a reserved coordinate.

## Minimal Reproducible Example

1. Reserve resources A, B, and C while only A is currently admitted.
2. Define the expected reservation as current admitted resources followed by B and C.
3. Admit B in a stacked branch.
4. The expected list becomes A, B, B, C.

## Context

This blocked integration of a child device-sync resource lane until its assertion was made independent of the child-extensible admission list.
