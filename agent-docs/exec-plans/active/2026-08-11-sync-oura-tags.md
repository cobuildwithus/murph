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
- Sanitized raw snapshots and evidence omit the free-text note value.
- Focused importer and device-sync tests pass.

## Scope

- In scope: Junction resource policy, note fetch/deduplication, normalization,
  privacy-safe raw evidence, tests, and matching durable docs.
- Out of scope: direct Oura OAuth changes, note-text search or display, new UI,
  and changes to Personal Patterns thresholds.

## Constraints

- Reuse the existing completed `intervention_session` event shape.
- Keep provider credentials, provider identifiers, and note text out of logs,
  fixtures, PR descriptions, and public artifacts.
- Use only synthetic tag names in committed fixtures.

## Tasks

1. Add a failing importer fixture for Oura-shaped Junction note data.
2. Add `note` to the bounded default resource policy and fetch identity.
3. Normalize distinct tags into stable completed intervention events.
4. Strip note text from retained raw data and evidence.
5. Update durable docs, run focused proof, and complete the PR review lane.

## Decisions

- Map each tag to one completed intervention event. This reuses the current
  factor model and avoids a new persisted type.
- Keep the tag name and date. Drop the note `value` because the requested
  feature does not need free text.
- Treat `note` as a sparse default timeseries resource. Unsupported providers
  continue through the existing optional-resource failure path.

## Verification

- Commands to run: focused Junction importer, device-sync provider/config, and
  Personal Patterns tests where the merged owner is available.
- Expected outcomes: Oura tags reach canonical events without retaining note
  text, duplicate events, or unrelated provider failures.
