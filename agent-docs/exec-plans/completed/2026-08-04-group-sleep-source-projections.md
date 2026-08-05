# Provider-aware group sleep projections

## Goal

Make consented group sleep reads truthful when a participant has multiple connected sleep sources: project every source's daily value, preserve the canonical selection, snapshot time, and disagreement state, and prevent Murph from presenting a stored cross-source snapshot as a live provider check.

## Success criteria

- A daily sleep share contains one bounded source entry per available sleep source for the date, up to the four-source contract limit, instead of collapsing the snapshot to one provider-neutral value.
- Every source entry has a safe public source label and its own value, unit, and recorded time; the record also identifies the canonical selected source/value used by existing challenge scoring.
- The encrypted snapshot carries a generation timestamp and explicit disagreement metadata.
- Existing exact-scope consent, revoke/regrant generation fencing, full-snapshot replacement, checkpoint-before-egress, and foreground-preemption behavior remain unchanged.
- The group reader preserves the new fields and instructs Murph to describe stored/provisional/conflicting data truthfully without claiming a live provider read.
- Legacy snapshots remain readable during deployment; new readers do not expose private provider account identifiers or raw device details.

## Implementation

1. Freeze the current producer, encrypted-store, Web reader, and model-adapter contracts with focused tests.
2. Extend the daily-metric wire shape with snapshot freshness, canonical selection, and bounded per-source observations.
3. Derive source observations from existing wearable candidate provenance without introducing a second query path or state owner.
4. Preserve the richer record through Web and the hosted execution model boundary.
5. Update group guidance and durable product documentation for source-aware, snapshot-qualified responses.
6. Run focused package tests and typechecks, inspect the privacy surface and final diff, then complete the required ReviewGPT and CI gates on the exact pushed head.

## Verification

- A three-source sleep fixture projects three public source observations and one deterministic canonical selection.
- Conflicting source values remain visible and are marked as disagreement; agreeing values are not falsely marked conflicting.
- Legacy daily-metric records still parse and render.
- Revoked, stale-generation, malformed, oversized, or ungranted projections remain unavailable or rejected exactly as before.
- Failed checkpoints still prevent projection egress, and foreground work can still preempt the optional refresh.
- Focused tests and typechecks pass for every changed package.

## Evidence

- The exact v1 contract rejects missing, duplicate, malformed, future-dated, source-ambiguous, oversized, or more-than-four-source records while keeping legacy v0 provider-neutral records readable.
- A synthetic three-source projection returns all three public sources, exactly one canonical selection, per-source recorded times, and truthful disagreement state without raw provider identifiers.
- The four-source bound is enforced per date: provider churn across the window preserves every valid date, while a single over-bound date is omitted without clearing its neighbors.
- Native one-reaction consent names the by-source values, source names, and recorded times, and the accepted offer grants only its exact v1 scope.
- A hosted-local scenario crosses exact consent, a real Temporal-backed maintenance checkpoint, encrypted Web delivery, and the destination group's authorized `read_shared` result with three synthetic sources and no provider fetch.
- Focused tests pass across hosted execution, query, assistant runtime, assistant engine, Web, and the Cloudflare runner; affected package/app typechecks pass.
- The source-aware runtime path measures 10,159,653 bytes in the macOS runner assembly; the bundle baseline records that intended growth while retaining the existing 32 KiB ratchet tolerance and forbidden-boot-input guard.
- The real consent component renders in a dedicated design-catalog study at desktop and mobile widths; local and hosted lossless captures remain legible at native resolution.
- The required fresh Fable UI double-check was attempted after the rendered surface stabilized but could not run because the account reported explicit usage-credit exhaustion.
- The mandatory round-3 anomaly retrospective compared the immutable
  first-reviewed and current shapes, attributed the review-driven growth, and
  chose explicitly justified continuation: the production correction remains
  small and inside existing owners, while nearly all added churn is
  production-path test evidence. No new state or lifecycle owner was added;
  another accepted finding in the same prompt-selection mechanism or any cure
  needing a new owner/state/lifecycle/compatibility path requires redesign or a
  scope split.
- Final ReviewGPT correction-verification round 4 returned `ROUND_OUTCOME:
  PASS` with no findings, and every required GitHub check passed on that exact
  reviewed head.

## Privacy and rollout

- Only safe provider display labels and already-consented metric values cross the existing encrypted exact-scope boundary.
- No provider account IDs, connection IDs, raw payloads, member identifiers, or local paths enter records, fixtures, diagnostics, or docs.
- Producer and reader changes must remain backward compatible so Web and runtime deploys can overlap safely.
Status: completed
Updated: 2026-08-05
Completed: 2026-08-05
