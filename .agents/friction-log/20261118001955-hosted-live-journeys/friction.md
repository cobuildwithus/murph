---
title: 'Hosted live journeys can silently lose deferred tools with an unlisted model'
severity: 'minor'
---

## Expected Behavior

A hosted live journey that relies on deferred tool discovery should identify an unsupported catalog selection before starting a provider turn.

## Current Behavior

The live runner accepts explicit models outside the pinned hosted catalog. A journey using only deferred dynamic tools can then reach the model without any of those tool calls occurring. The same model can invoke the canonical contracts when the fixture registers them eagerly.

## Minimal Reproducible Example

Use a synthetic live journey that registers only deferred dynamic tools and loads the catalog produced by the hosted runner fixture. Select an available subscription model absent from the pinned catalog, such as gpt-6.2-sol with a catalog that lists gpt-6.1-sol, and ask it to invoke one of the registered tools.

## Context

The missing model entry surfaced as an assistant behavior failure during a focused reminder patch journey. That journey now registers the same contracts eagerly to cover the requested model while deterministic tests cover deferred discovery.
