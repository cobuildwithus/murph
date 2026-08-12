# Preserve Junction body composition fidelity

Status: completed
Created: 2026-08-11
Updated: 2026-08-11

## Goal

- Preserve Junction bone mass percentage, muscle mass percentage, visceral fat index, and water percentage as canonical body-composition measurements.

## Success criteria

- Each supported scalar maps to a distinct stable metric and correct unit.
- Missing or invalid values remain omitted without affecting existing body metrics.
- The new metrics are available through the existing wearable query seam.
- Focused importer/query coverage and package typechecks pass.

## Scope

- In scope: Junction body summary normalization, metric catalog ownership, focused tests, compatibility documentation, and an accurate changelog disposition.
- Out of scope: other providers, inferred body-composition values, and unrelated audit findings.

## Constraints

- Technical constraints: use canonical scalar measurements and the existing wearable metric catalog; add no provider-specific storage or new abstraction.
- Product/process constraints: preserve source evidence, omit unsupported inference, and keep the PR independently mergeable.

## Risks and mitigations

1. Risk: Percentage and index units are conflated.
   Mitigation: keep documented percentage fields in percent and visceral fat index as a scalar score with focused assertions.
2. Risk: Import-only coverage misses query visibility.
   Mitigation: exercise the established wearable query registry for every new key.

## Tasks

1. Inspect and apply the ReviewGPT implementation patch.
2. Simplify or correct the patch against repository ownership and provider contracts.
3. Run focused tests and typechecks.
4. Commit, push, open the PR, and run ReviewGPT plus required CI gates.

## Decisions

- Represent all four fields as independent scalar metrics rather than a compound provider payload.

## Verification

- Junction importer suite — passed, 144 tests.
- Health metrics suite — passed, 53 tests.
- Query normalized-surface and projection suites — passed, 112 tests.
- Importers, health-metrics, and query package typechecks — passed.
- Changelog fragment suite — passed, 7 tests.
- Hosted web typecheck — passed.
- Confirmed all four fields remain distinct and queryable while missing and invalid input is safely omitted.
Completed: 2026-08-11
