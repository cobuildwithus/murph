# Preserve Junction activity and sleep summary fidelity

Status: completed
Created: 2026-08-11
Updated: 2026-08-11

## Goal

- Preserve the Junction activity summary's supported heart-rate and intensity facts independently, and normalize sleep latency through the existing wearable metric pipeline.

## Success criteria

- Average, walking-average, minimum, maximum, and resting heart rate remain distinct normalized measurements.
- High-, medium-, and low-intensity minutes remain distinct while the existing aggregate activity-minutes behavior stays compatible.
- Sleep latency is normalized in minutes without changing the provider's seconds contract.
- Focused importer/query coverage and package typechecks pass.

## Scope

- In scope: Junction activity and sleep normalizers, metric catalog ownership, focused tests, compatibility documentation, and an accurate changelog disposition.
- Out of scope: other providers, new presentation surfaces, and unrelated audit findings.

## Constraints

- Technical constraints: reuse canonical measurement events and the existing wearable metric catalog; do not add provider-specific storage or duplicate query paths.
- Product/process constraints: preserve evidence and replay identity, avoid clinical interpretation, and keep the patch independently mergeable.

## Risks and mitigations

1. Risk: New keys normalize successfully but remain absent from wearable queries.
   Mitigation: register the scalar metrics with their current owners and prove the query seam in focused coverage.
2. Risk: Intensity units are misread as durations in seconds.
   Mitigation: preserve Junction's documented minute values without conversion and test all three independently.

## Tasks

1. [x] Inspect and apply the ReviewGPT implementation patch.
2. [x] Simplify or correct the patch against repository ownership and provider contracts.
3. [x] Run focused tests and typechecks.
4. [x] Commit, push, open the draft PR, and start ReviewGPT plus required CI gates.

## Decisions

- Keep the existing aggregate activity-minutes metric for compatibility while adding independent intensity measurements.

## Verification

- Focused importer, health-metric, query, stored-codec, source-health, and CLI schema suites: 240 passed.
- Importers, health-metrics, query, and CLI package typechecks: passed.
Completed: 2026-08-11
