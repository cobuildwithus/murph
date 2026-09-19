# Reduce meal workflow tool round trips and query latency

Status: active
Created: 2026-09-19
Updated: 2026-09-19

## Outcome and invariants

Make ordinary meal capture and the ensuing daily nutrition card require fewer
model round trips, while preserving canonical writes, date semantics, complete
coverage, numeric suitability, goal authority, and the single outbox-owned card.
No production messages, feedback, identifiers, or records enter fixtures.

## Owners and proven gap

The CLI owns command composition, importers/core own meal persistence, query owns
canonical totals and goal resolution, and assistant skills own suitability and
presentation. Current meal listing awaits the broad query projection and applies
its output limit after fetching every matching record. Save and selected-date
totals are separate commands. These are the reproduction targets.

## Scope and decisions

- Reproduce meal list/read costs with synthetic unrelated vault data and prove
  projection independence before changing the read path.
- Extend the existing meal save command to return an opt-in fresh daily summary,
  avoiding a second mutation owner or automatic presentation/goal decisions.
- Keep successful save evidence authoritative if the subsequent summary fails;
  recovery must retry only the read, never create a duplicate meal.
- Teach the shipped food workflow the composed command and concise exact flags.
- Preserve ordinary reads and old command results without the opt-in.
- Inspect provider timeout evidence and native recovery tests; do not add a
  Murph transport supervisor or shorten a shared timeout without faithful proof.

## Product UX

Effort: Patch.
Outcome: less waiting for a correctly logged meal and eligible daily summary.
Reaches: private routine capture, number-sensitive capture, incomplete totals,
missing/conflicting goals, explicit dates and local-day boundaries, failed reads.
Proof: canonical readback, deterministic schema/order/failure tests, synthetic
performance comparison, focused production-derived real-Codex capture journey.
Card suitability and existing delivery/audience gates remain unchanged.

## State, failure and deployment

No new persisted state or service. All mutations retain their existing owner.
The combined result is additive and opt-in. Producer guidance and CLI ship in the
same runner artifact; old callers retain ordinary save/read behavior. Summary
failure after persistence returns saved evidence plus a read-only recovery path.

## Tasks

1. Inspect feedback diagnostics and current owner contracts; reproduce costs.
2. Implement the smallest composition and read-path correction.
3. Add focused deterministic, performance and real-model proof.
4. Update durable owners and changelog, review privacy and complexity.
5. Open a draft PR, run routed ReviewGPT and exact-head CI, and close the plan.

## Verification

- Focused CLI suites: 21 passed; meal source tests: 3 passed; shipped skill
  contracts: 17 passed. CLI, usecase, assistant and Web typechecks passed.
- Synthetic meal list baseline reproduces projection creation; the candidate
  skips it and preserves full list output, corrections and tombstones. With
  8,000 unrelated events, cold projection/source reads measured 1,507/25 ms;
  warm 2/24 ms; after-write 1,341/25 ms. See the benchmark README for limits.
- The focused real Terra journey through local subscription saved once using
  the combined result and attached one correct card, without show/totals reads
  or a renewed goal invitation. One compact preference read
  remained; the final run had no help discovery and took approximately 24 seconds including
  harness setup. This proves effects, not a universal latency guarantee.
- Full first provider-input captures at base/head: individual 159,105/159,105
  bytes; group 150,101/150,101 bytes. The deferred card description grew 273
  registered bytes; no initial request growth. Exact Terra tokenizer unavailable;
  token totals/deltas are unmeasured. Excluded transport prompt_cache_key.
- Complexity ratchet passes; existing meal-add/nutrition-option hotspots remain
  33/32 with no increased debt. No extra service, cache or mutation owner.
- Changelog archive: 10 focused tests passed via repository-root invocation;
  the documented app-directory command missed discovery (existing Frog entry).
- Provider transport changes remain excluded: no faithful deterministic
  reproduction supporting a new timeout or recovery policy was established.

- The number-sensitive live journey also passed: one truthful nonnumeric log
  confirmation, no card, no optional daily totals, and no goal invitation. The
  owning guidance now resolves unknown canonical preferences before saving,
  reusing that read for subsequent suitability and invitation decisions.

Parent candidate review is complete. Pending: stable-head ReviewGPT, required
CI and plan closure. No production mutation or deployment is included.
