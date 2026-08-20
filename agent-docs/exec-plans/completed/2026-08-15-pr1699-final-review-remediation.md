# PR 1699 Final Review Remediation

Status: completed
Created: 2026-08-15
Updated: 2026-08-15

## Goal

- Resolve final ReviewGPT round 12 findings so workout features share the
  canonical workout-local day, are materialized once in the focused wearable
  projection, and expose unit-bearing speed/power fields before a new exact-head
  review and merge.

## Success criteria

- Offset, explicit-calendar, and vault-timezone workouts expose their features
  on exactly the same day as the owning activity session, including correction
  to an explicit empty split list.
- `wearables activity list` uses the existing filtered
  `query_wearable_summaries` read and no per-command full-vault hydration.
- Public speed and power names carry units (`Mps` and `Watts`), and ambiguous
  unitless names are absent.
- Focused tests, typechecks, required GitHub checks, and the next ReviewGPT
  round pass before merge.

## Scope

- In scope: compact feature day metadata, query projection types/collection and
  stored public summaries, provider composition, CLI/assistant contracts,
  bounded/privacy/performance regression proof, docs, PR metadata, review/CI,
  merge, and worktree retirement.
- Out of scope: a new query table, command, screen, raw stream retention,
  activity-session replacement, or new retry/persistence lifecycle.

## Constraints

- Technical constraints: preserve one resource/day ingestion owner, one focused
  wearable-summary runtime read, 32 workouts/64 splits, hashed internal
  grouping, authoritative correction, and raw identifier exclusion.
- Product/process constraints: treat completed plan snapshots as immutable,
  update the projection schema version for the stored-shape change, run the
  next full-snapshot ReviewGPT round on the corrected pushed head, and do not
  bypass the native-iOS required gate.

## Risks and mitigations

1. Risk: provider-local and vault-local dates diverge from normalized UTC.
   Mitigation: carry only authoritative raw-summary day evidence; omit the
   scalar when core must resolve the vault-local day.
2. Risk: provider-row composition drops or duplicates public workout features.
   Mitigation: partition features by provider during projection, merge them by
   activity date after cross-provider recomposition, sort deterministically,
   and reapply public bounds.
3. Risk: stored projections remain stale after the shape changes.
   Mitigation: bump the query projection SQLite version and prove rebuild/read
   behavior.

## Tasks

1. Carry canonical workout-day evidence through the bounded feature and remove
   forced UTC-prefix day ownership.
2. Move workout-feature grouping into the query-owned projection and delete the
   vault-usecases full-read helper and second freshness path.
3. Rename public speed/power fields to unit-bearing keys and update CLI,
   assistant guidance, scenarios, changelog, and durable docs.
4. Add production-vault day/correction/privacy proof plus focused stored-query
   and bounded maximum-cardinality proof.
5. Run scoped verification, commit/push, update the PR, rerun final ReviewGPT
   and required CI, then merge and retire the worktree.

## Decisions

- Accept all three final round 12 findings as review-induced material issues.
- Store public workout features inside existing provider-scoped activity
  summary rows; do not add a table or a foreground entity scan.
- Carry an optional `workoutDayKey` only when raw provider calendar/offset
  evidence owns the day. Omit it for bare UTC input so canonical vault timezone
  resolution remains authoritative.

## Verification

- Passed all affected package typechecks for importers, query, vault-usecases,
  CLI, and assistant-engine.
- Passed 167 Junction importer cases, 11 bounded-feature cases, the real-vault
  stale-split retraction case, the two production-vault workout-query cases,
  and 31 focused query projection/codec/source-health cases.
- Passed the CLI response schema and generated skill-hash/package-shape checks,
  the assistant skill-assets suite, and the real scripted connected-health
  journey through the App Server.
- Passed changelog generation and its 38 entry tests, 13 PR-changelog guard
  tests, docs drift, provider-request boundaries, diff whitespace, and
  identifier/secret scans.
- Remaining remote completion after the exact candidate is pushed: final
  ReviewGPT round 13 and exact-head required CI. The Native iOS hosted E2E
  environment currently lacks its required repository-owned configuration; do
  not bypass that gate.
Completed: 2026-08-15
