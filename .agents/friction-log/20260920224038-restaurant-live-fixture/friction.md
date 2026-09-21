---
title: 'Restaurant live fixture rejects documented batched reads'
severity: 'minor'
---

## Expected Behavior

The restaurant meal live fixture should accept independent memory and food-label reads through the production batch command contract.

## Current Behavior

The fixture rejects every batch command even though the production meal skill recommends grouping independent reads. This introduces artificial recovery work and can invalidate source-lookup ordering assertions.

## Minimal Reproducible Example

Materialize the restaurant fixture, then execute a batch containing memory show and an exact synthetic restaurant food search. Both individual commands are supported, but the combined command exits as unsupported.

## Possible Solution

Dispatch the two supported read families through the existing fixture and validate the aggregate envelope against the production batch schema. Keep unsupported and mutating batch families rejected.

## Context

Found while strengthening meal-tool efficiency journeys. The same task adds bounded batch support and a deterministic contract check before rerunning the live model.
