# Restore shared workout summaries from canonical sessions

Status: active
Created: 2026-08-31
Updated: 2026-08-31

## Goal

- Restore consented group workout summaries from canonical workout sessions
  without weakening the intentionally privacy-preserving stored wearable
  summary format.
- Collapse the legacy projection's dependence on provenance identifiers that
  are deliberately removed before persistence.

## Product UX Patch

- Outcome: a group member who shares workout summaries has recent workout
  counts and minutes appear after canonical device workouts sync.
- Reaches: the existing consent-aware `workout-days.v0` group shared-data read;
  sharing permissions and detailed workout visibility do not change.
- Proof: one canonical activity session survives the persisted query-summary
  round trip and produces a non-empty shared day, while no-workout and
  non-granted cases remain unchanged; a focused real-Codex group journey states
  the available workout summary truthfully.

## Success criteria

- A stored single-provider wearable summary yields a valid paired workout day.
- Aggregate selection remains fail-closed for genuinely split provider/source
  evidence, independently authored manual/Murph points, and malformed values.
- No raw canonical record identifiers are added to stored public summaries.
- Focused deterministic tests, typechecks, and the real-Codex journey pass.
- Exact-head review and required CI are green.

## Scope

- In scope: legacy workout-day projection composition, focused query/runtime
  regressions, group assistant journey coverage, and a public changelog item.
- Out of scope: provider ingestion, canonical workout storage, consent scopes,
  detailed `workouts.v0` shape, historical backfills, and manual production
  repair.

## Constraints

- Technical constraints: retain one canonical stored-summary codec and its
  privacy boundary; use existing query and share owners; add no new service,
  state owner, dependency, or compatibility layer.
- Product/process constraints: preserve unrelated work, use the isolated
  worktree/PR lane, keep all evidence synthetic and private-free, and follow
  the assistant verification and completion gates.

## Risks and mitigations

1. Risk: weakening the provenance join could combine unrelated metric points.
   Mitigation: preserve exact-owner matching by default and admit only
   non-manual/non-Murph derived activity summaries from one public source.
2. Risk: changing the stored summary codec could expose canonical identifiers.
   Mitigation: leave the codec untouched and assert the persisted round trip.
3. Risk: a narrow unit test could miss the composed failure.
   Mitigation: test the real persisted query-summary boundary plus the actual
   share reader and one production-contract real-Codex journey.

## Tasks

1. Add the composed failing regression for a persisted canonical activity
   session reaching `workout-days.v0`.
2. Replace the lossy provenance coupling with the smallest canonical evidence
   derivation and delete obsolete pairing complexity where possible.
3. Add boundary cases and one focused real-Codex group journey.
4. Update the public changelog and durable docs only if the architecture
   contract changes.
5. Run focused verification, Product UX replay, parent review, exact-head CI,
   and required ReviewGPT gates.

## Decisions

- Preserve the stored public-summary redaction boundary; canonical record IDs
  must not be reintroduced merely to satisfy a downstream legacy join.
- Keep strict source-owner matching for every ordinary metric pair. The only
  exception is the query-produced, non-manual/non-Murph `activity-summary`
  pair whose private owner IDs were intentionally redacted after both values
  were derived from the same selected provider session rollup.
- Keep `workouts.v0` independent: its time window, detail contract, dedupe,
  and settlement semantics differ from the daily count-and-minutes projection.

## Verification

- Focused query and assistant-runtime Vitest files covering the composed path.
- Assistant Engine real-Codex journey selected by one unique test pattern.
- Live journey reply review: the model read the correct `workout-days.v0`
  scope and answered the synthetic count/minutes truthfully, but remains Hold
  because it repeated the identical read. The existing shared-sleep journey
  reproduces that same current-model action-count regression.
- Typechecks for every changed production package.
- `git diff --check`, privacy/identifier scan, Product UX walkthrough, exact
  pushed-head ReviewGPT, and required GitHub checks.
