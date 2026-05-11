# Murph Age Model Card Status

## Goal

Add a safe CLI status surface for local Murph Age research model-card artifacts so an operator can see whether a vault has research-usable score-bearing cards and why product display remains blocked.

## Scope

- Add an `age model-cards` command that reports card policy status, loaded-card presence, research usability, product-display readiness, and warning codes.
- Keep the output aggregate/metadata-only: no model coefficients, model IDs, row values, point IDs, raw local paths, or product claims.
- Add focused CLI coverage and regenerate the CLI command artifacts if the command topology changes.

## Out of Scope

- Product authorization, model promotion, new science/model coefficients, dataset ingestion, or ReviewGPT architecture review.
- Changing `age report` scoring behavior.

## Verification

- Focused Murph Age CLI tests.
- CLI typecheck/package-shape checks as needed.
- Required diff checks and scoped audit before commit.

## Status

Active.
Status: completed
Updated: 2026-05-11
Completed: 2026-05-11
