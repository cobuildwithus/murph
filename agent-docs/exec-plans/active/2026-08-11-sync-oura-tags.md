# Sync Oura tags through Junction

Status: active
Created: 2026-08-11
Updated: 2026-08-11

## Goal

- Fetch Oura note tags through Junction and store each tag as a dated,
  completed intervention that Personal Patterns can analyze.
- Do not use or retain the free-text note value for this feature.

## Success criteria

- Junction requests the documented `note` timeseries resource by default.
- One Oura note with multiple tags creates one stable event per distinct tag.
- Repeated imports and overlapping windows remain idempotent.
- Same-time notes with different tags survive fetch-side deduplication.
- New and existing Oura sources receive one bounded 180-day note backfill.
- Dense timeseries keep their existing short sync windows.
- Sanitized raw snapshots and evidence omit the free-text note value.
- A synthetic provider-shaped note reaches persisted events and Personal
  Patterns when imported twice.
- Focused importer, device-sync, and vault-usecase tests pass.

## Scope

- In scope: Junction resource policy, note fetch/deduplication, normalization,
  privacy-safe raw evidence, bounded note history, tests, and matching durable
  docs.
- Out of scope: direct Oura OAuth changes, note-text search or display, new UI,
  and changes to Personal Patterns thresholds.

## Constraints

- Reuse the existing completed `intervention_session` event shape.
- Keep provider credentials, provider identifiers, and note text out of logs,
  fixtures, PR descriptions, and public artifacts.
- Use only synthetic tag names in committed fixtures.

## Tasks

1. Add an importer fixture for Oura-shaped Junction note data.
2. Add `note` to the default resource policy and fetch identity.
3. Normalize distinct tags into stable completed intervention events.
4. Strip note text from retained raw data and evidence.
5. Reuse the sparse-timeseries history lane for a 180-day note catch-up.
6. Prove the full provider-to-Patterns path with a replayed synthetic snapshot.
7. Update durable docs, run focused proof, and complete the PR review lane.

## Decisions

- Map each tag to one completed intervention event. This reuses the current
  factor model and avoids a new persisted type.
- Keep the tag name and date. Drop the note `value` because the requested
  feature does not need free text.
- Treat `note` as a sparse default timeseries resource. Unsupported providers
  continue through the existing optional-resource failure path.
- Reuse the existing sparse-timeseries backfill owner. Track note coverage
  separately from blood-pressure coverage, per connected source.
- Derive UTC note dates from the ISO date prefix when the normal timestamp
  path has no local day key.

## Verification

- Commands run: complete importer, device-sync, and vault-usecase package tests;
  matching package typechecks; diff validation.
- Expected outcomes: Oura tags reach canonical events without retaining note
  text or duplicate events. The history job runs once per source. Personal
  Patterns sees the repeated synthetic sauna factor.
