# Linear Browser Vault metric projection

Status: active
Created: 2026-08-30
Updated: 2026-08-30

## Goal

- Make large Browser Vault refreshes build their metric projection with one
  explicit indexed data flow instead of repeatedly scanning and sorting the
  same point collection, while preserving every replica value and ordering.

## Product UX

- Outcome: members with long metric histories wait less for their private
  dashboard data to refresh in the background.
- Reaches: authenticated Web surfaces backed by Browser Vault metric rows and
  current-value selections; no UI, copy, authority, or data semantics change.
- Proof: the median of five warm runs over 20,000 points and 100 metric
  requests fell from 2.32 seconds to 0.87 seconds, with the same 20,000 rows
  and 100 selections; focused tests cover deterministic ordering and
  biomarker-specific selection.
- Walkthrough: ready. Interleaved metric histories and requests that share a
  metric key but not a biomarker retain the existing result and order.

## Success criteria

- Metric-series and current-value selection receive only the points relevant to
  each normalized metric request rather than the complete point collection.
- Existing replica fixtures remain deep-equal and produce the same stable data
  version for identical source facts.
- The change adds no cache, persisted state, queue, schema, generation, or
  feature-specific selection abstraction.
- Focused package tests, typecheck, exact-head CI, and repository review gates
  pass for the final PR head.

## Scope

- In scope:
  - Browser Vault metric-point grouping and request-local selection inputs.
  - Focused equivalence, selection, and traversal-count tests.
- Out of scope:
  - Metric selection semantics, catalog policy, lookback rules, projection
    schema/generation, sharding, encryption, transport, timeout, or retries.
  - Semantic deduplication or a custom compact replica encoding.
  - Removing the legacy monolith before its documented compatibility window.

## Constraints

- Technical constraints:
  - Preserve deterministic request and row ordering, duplicate policy,
    biomarker filtering, anchor exceptions, and selection warnings.
  - Keep the optimization inside current `packages/query` owners and public
    boundaries; add no dependency or persisted cache.
- Product/process constraints:
  - Browser Vault remains derived, rebuildable, private, background work.
  - Query-visible truth continues to come from one strict canonical snapshot;
    the local SQLite projection remains outside this flow.

## Risks and mitigations

1. Risk: Grouping only by metric key accidentally broadens or narrows a
   biomarker-specific request.
   Mitigation: Keep biomarker filtering in the existing selectors and prove
   mixed-biomarker fixtures against the prior output.
2. Risk: A timing assertion is noisy in CI.
   Mitigation: Assert bounded traversal/call structure and exact output in CI;
   record elapsed before/after evidence outside the test contract.

## Tasks

1. Trace every full point-collection and wearable-collection pass in replica
   construction and capture the focused baseline.
2. Introduce the smallest request-local metric grouping primitive at the
   existing Browser Vault selection boundary.
3. Keep wearable collection out of this patch because its consumers have
   intentionally different raw-bundle and default-visible semantics.
4. Add equivalence and ordering tests, then run focused package proof,
   typecheck, scenario integrity, and privacy/diff checks.
5. Open a draft PR, complete ReviewGPT and exact-head CI, close this plan, and
   mark the PR ready only after all completion gates pass.

## Decisions

- Optimize by narrowing existing inputs and deleting duplicate collection work,
  not by changing metric semantics or introducing a cache.
- Keep this PR independent from serializer buffering so each performance cause
  remains reviewable and reversible on its own.

## Verification

- Commands to run:
  - Focused Browser Vault metric and replica Vitest files selected after the
    final touched-owner trace.
  - `pnpm --dir packages/query typecheck`
  - `pnpm test:scenario-integrity`
  - Exact-head required GitHub checks and repository ReviewGPT gates.
- Expected outcomes:
  - Existing replica values, order, and stable hashes remain unchanged.
  - One metric grouping pass feeds request-local selection work; the neutral
    20,000-point/100-request fixture falls from a 2.32-second median to a
    0.87-second median, and all checks pass.
