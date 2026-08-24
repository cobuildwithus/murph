# Usage-Limit Cross-Source Recovery

Status: completed
Created: 2026-08-24
Updated: 2026-08-23

## Goal

Let later pending conversation work resume the canonical usage-limit recovery
notice when an earlier rich-link replay remains incomplete, without changing
the original delivery provenance or allowing ordinary over-limit replies.

## Evidence

- The exact paired integration observed the accepted primary notice, two
  ambiguous link attempts, and a delayed primary replay, but no final link.
- Reconciliation retained blocked conversation work and fell back to the next
  billing reset because the later pending event had a different source
  reference from the canonical notice row.
- The notice idempotency key, channel, target, period, and ledger epoch already
  identify the single recovery owner; the source reference is provenance, not
  ownership.

## Approach

- Prove the cross-source recovery path at the delivery-store owner.
- Remove only the redundant source-reference equality from the canonical
  rich-link partial replay predicate while preserving the stored source.
- Re-run the production-shaped paired scenario before either repository merges.

## Verification

- Focused delivery-store and transport tests.
- Web typecheck.
- Exact-head public CI and required ReviewGPT gates.
- Exact paired public/private hosted integration, including the delivery
  ambiguity shard and Temporal aggregate.
Completed: 2026-08-23
