---
title: 'Nested nutrition goal unions erase concrete Codex card declarations'
severity: 'minor'
---

## Expected Behavior

A valid inline JSON Schema for all-null or all-present nutrition goals should retain concrete nutrient and compact-table fields after real Codex tool discovery.

## Current Behavior

Wrapping the goals object in a nested anyOf caused native discovery to replace nested card properties with empty schemas and code-mode declarations to show unknown. Removing that union restored the definitions. The existing approximate schema-size check did not catch this representation; the real provider-contract checks did.

## Possible Solution

Keep the flat typed goal fields with an if/then/else constraint for bundle consistency. Preserve the real native and code-mode contract checks as the compatibility authority, and consider making them easier to discover when changing card schemas.

## Minimal Reproducible Example

Use the response-card authoring schema with goals.anyOf containing a five-object branch and a five-null branch. Run the focused provider-visible bounds and concrete nutrition declaration tests in the assistant-engine package. Compare with the flat conditional representation and validate all 32 goal-presence combinations through the CLI compatibility test.

## Context

Found while preparing PR #3347. The task corrects the schema representation without relaxing canonical runtime validation. All examples and test data are synthetic.
