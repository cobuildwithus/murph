# Murph Age Input Readiness

## Goal

Add a safe CLI readiness surface for Murph Age inputs so an operator can see which labs, vitals, and wearable context features are present or missing before trying to calculate a research-only age estimate.

## Scope

- Add an `age inputs` command that reports the current input bundle status, recommended research card, ready/missing feature keys, selected metric keys, context bundles, and warning codes.
- Include the command in the agent-facing CLI descriptor manifest so schema-rich discovery sees the readiness surface.
- Use the existing Murph Age input-bundle assessment logic rather than inventing a second readiness model.
- Keep the output metadata-only: no metric values, canonical values, selected point ids, row values, local paths, model internals, product claims, protocol claims, or recommendations.
- Add focused CLI/query coverage and regenerate CLI command artifacts if command topology changes.

## Out of Scope

- Product authorization, model promotion, scoring changes, new model features, new source ingestion, recommendations, or ReviewGPT research-direction review.
- Changing `age report` or `age model-cards` behavior.

## Verification

- Focused Murph Age CLI/query tests.
- Focused descriptor/LLM manifest coverage for `age inputs`.
- CLI generated-artifact checks as needed.
- Required diff checks and scoped audit before commit.

## Status

Active.
Status: completed
Updated: 2026-05-11
Completed: 2026-05-11
