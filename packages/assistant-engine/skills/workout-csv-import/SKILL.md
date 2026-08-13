---
name: workout-csv-import
description: Use when a member sends or references a workout-history CSV for import, including Strong, Hevy, an unknown export format, or a large custom spreadsheet whose rows must be grouped into canonical workouts. Owns provider inspection, source preservation, local Python transformation, schema validation, batch import, and replay safety; use strength-training only when programming or interpretation is also requested.
---

# Workout CSV import

Import the full file with one bounded local transformation and one canonical
batch write. Keep raw rows out of model context and user-facing replies.

## Choose the owning path

1. Run `vault-cli workout import inspect <readable-file-path> --format json`.
2. If inspection recognizes Strong or Hevy, follow its plan and use
   `vault-cli workout import csv`. Resolve any requested provider, timezone,
   weight unit, or distance unit; that request is not a format failure. Do not
   bypass this path with Python because the dedicated importer owns immutable
   raw evidence, snapshot refreshes, corrections, edits, and deletions.
3. Use the generic workflow only when the dedicated planner cannot recognize
   the layout. Do not create a new provider adapter or install a parser package
   for a one-off format.

## Preserve and map an unfamiliar source

1. Preserve the CSV once with `vault-cli document import <readable-file-path>
   --source import --title "Workout CSV source" --format json`. Keep the
   returned document id and raw file ref. This is the durable source if mapping
   cannot safely finish; a temporary script or JSONL file is not durable proof.
2. Use a small local Python 3 script and only the standard-library `csv`,
   `datetime`, `hashlib`, and `json` modules. Inspect headers, dialect, bounded
   samples, row count, and privacy-safe aggregate values locally. Never print
   the complete source, expand all rows into model context, or make one model or
   CLI call per row or set.
3. Run `vault-cli event payload-schema --for import-jsonl --kind
   activity_session --format json`. Treat that returned schema as authoritative;
   do not rely on a remembered payload shape.
4. Determine one source-backed grouping key per workout and map the complete
   source to one temporary JSONL row per workout. Attach the preserved raw file
   ref through the schema-supported provenance field. Resolve all consequential
   meanings: grouping, local date/time and timezone, positive duration, units,
   activity type, exercise names and order, set order and type, reps, load,
   distance, and notes. Preserve source values without inventing precision.
5. If the source cannot prove one of those meanings, ask one targeted question
   that presents the inferred column mapping and the unresolved choice. Never
   guess. A user-approved default such as one duration for every workout is
   valid provenance; an unspoken default is not.

## Make replay behavior explicit

- Add `externalRef` only when a deterministic, unique session identity can be
  derived from stable source fields. A provider session id is best. A digest of
  the immutable raw source plus a unique, normalized source-backed workout key
  makes replay of that exact artifact safe, but does not make a later refreshed
  export safe; disclose that limitation when it applies. Never use row number,
  row order, or a model-created label as identity.
- Check uniqueness before writing JSONL. Use a stable lowercase slug for
  `system` and `resourceType`; keep `resourceId` deterministic and within the
  returned schema. Do not invent `externalRef.version` unless the source
  provides a version with proved ordering semantics.
- Without a stable identity, say before apply that the batch is append-only and
  a repeat can duplicate workouts. Apply it at most once for the current request
  and never blindly retry after an ambiguous failure.

## Validate, apply, and verify

1. Write all grouped workouts to one temporary JSONL file. Record its SHA-256
   digest and privacy-safe aggregates: source rows, grouped workouts, ignored
   rows by reason, and the mapped date range. Do not log raw rows.
2. Dry-run the complete file:

   `vault-cli event import-jsonl --input @<temporary.jsonl> --format json`

   Require `receivedCount` to equal the grouped-workout count. Explain any
   ignored source rows. Stop on validation errors or surprising skips or
   supersedes; do not narrow the batch until it passes.
3. Confirm the JSONL SHA-256 is unchanged, then apply those exact bytes once:

   `vault-cli event import-jsonl --input @<temporary.jsonl> --apply --format json`

4. Treat the apply receipt as the batch result. Confirm a bounded,
   representative selection through canonical `event list` or `show` reads,
   covering the imported date range when practical. Do not claim a full
   readback count if the query limit sampled only part of a large import.
5. Tell the member how many workouts were created, skipped, or updated, the
   mapped date range, any deliberately ignored rows, and any replay limitation.
   Never expose internal ids, raw rows, temporary paths, or bookkeeping jargon.
