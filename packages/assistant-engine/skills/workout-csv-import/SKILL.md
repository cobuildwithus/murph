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

Before writing any helper or command output, create one private attempt
directory under `.runtime/tmp/workout-csv-import/` and keep every ephemeral
file for this import inside it: the Python helper, inspection and schema
receipts, transformed JSONL, digest, dry-run/apply/status/readback receipts,
errors, and summaries. Use an unpredictable attempt name and restrictive
permissions. Remove the whole attempt directory after success, a clarification,
or any handled failure. If the process or workspace stops first, do not move
these files elsewhere for recovery: `.runtime/tmp/**` is excluded from hosted
snapshots, and canonical source/import-audit state is the later-turn recovery
owner.

1. Preserve the CSV once with `vault-cli document import <readable-file-path>
   --source import --title "Workout CSV source" --reuse-exact --format json`.
   This exact-byte mode reuses a prior live source document across turns instead
   of minting attempt-local provenance. Keep the
   returned document id and raw file ref. This is the durable source if mapping
   cannot safely finish; a temporary script or JSONL file is not durable proof.
   If exact reuse reports that the prior source document was deleted, stop
   before Python and event import. Explain that Murph will not silently create a
   replacement source identity; do not bypass the conflict with ordinary
   document import in this workout workflow.
   If exact reuse instead reports incomplete or damaged preserved source
   evidence, also stop before Python and event import. Explain that the existing
   evidence needs explicit recovery; never replace or bypass that identity.
2. Immediately run `vault-cli document workout-import-status <raw-file-ref>
   --format json`. If `status` is `completed`, the atomic workout import for
   this exact source completed in an earlier attempt. Stop before Python or
   JSONL generation and tell the member the source was already imported. If
   `status` is `partial_conflict`, stop and explain that workout history exists
   without a whole-source completion receipt and must be resolved before a safe
   retry. Proceed only when `status` is `not_imported`. The completion receipt
   remains valid after an imported workout is edited or deleted.
3. Use a small local Python 3 script with the standard library only. Typical
   modules include `csv`, `datetime`, `hashlib`, and `json`; when an offsetless
   wall-clock timestamp has a known IANA timezone, use `zoneinfo.ZoneInfo` so
   historical and daylight-saving offsets are applied per date. Reject an
   ambiguous or nonexistent daylight-saving wall time before writing and ask
   one targeted question when the source cannot disambiguate it. Inspect
   headers, dialect, bounded samples, row count, and privacy-safe aggregate
   values locally. Never print the complete source, expand all rows into model
   context, or make one model or CLI call per row or set.
4. Run `vault-cli event payload-schema --for import-jsonl --kind
   activity_session --format json`. Treat that returned schema as authoritative;
   do not rely on a remembered payload shape.
5. Determine one source-backed grouping key per workout and map the complete
   source to one temporary JSONL row per workout. Attach the preserved raw file
   ref through the schema-supported provenance field. Resolve all consequential
   meanings: grouping, local date/time and timezone, positive duration, units,
   activity type, exercise names and order, set order and type, reps, load,
   distance, and notes. Preserve source values without inventing precision.
6. If the source cannot prove one of those meanings, ask one targeted question
   that presents the inferred column mapping and the unresolved choice. Never
   guess. A user-approved default such as one duration for every workout is
   valid provenance; an unspoken default is not.

## Make replay behavior explicit

- Do not add model-authored `externalRef` values. Exact-source recovery belongs
  to the preserved raw reference and immutable event history, not a temporary
  transformer's namespace or normalization choices.
- A refreshed export with different bytes is a new source. The generic path
  cannot safely infer provider corrections, edits, or deletions across exports;
  disclose that limitation. Strong and Hevy retain those richer semantics.
- Never blindly retry a failed apply. When the apply child definitely exits
  without a trusted receipt and the current turn still has the raw ref and
  temporary JSONL, first verify that the JSONL digest is unchanged and run the
  exact-source status check again in the same turn. `completed` means the
  original apply committed: perform a bounded canonical read and report that
  result without another apply. `partial_conflict` stops for explicit recovery.
  `not_imported` permits exactly one proof-backed recovery apply of the same
  verified bytes; confirm its receipt and canonical readback. Never make more
  than one recovery attempt or more than one successful canonical apply.
- If the child may still be running, its termination is unknown, the digest
  changed, status is unavailable, or the canonical lock cannot be trusted, do
  not retry. Report the genuinely unresolved result. A later-turn status check
  remains the recovery path only when the original turn or workspace was lost.

## Validate, apply, and verify

1. Write all grouped workouts to one JSONL file in the current private attempt
   directory. Record its SHA-256 digest and privacy-safe aggregates there:
   source rows, grouped workouts, ignored rows by reason, and the mapped date
   range. Do not log raw rows.
2. Dry-run the complete file:

   `vault-cli event import-jsonl --input @<temporary.jsonl> --source-raw-ref-once <raw-file-ref> --format json`

   Require `receivedCount` to equal the grouped-workout count. Explain any
   ignored source rows. Stop on validation errors or surprising skips or
   supersedes; do not narrow the batch until it passes.
3. Confirm the JSONL SHA-256 is unchanged, then apply those exact bytes once:

   `vault-cli event import-jsonl --input @<temporary.jsonl> --source-raw-ref-once <raw-file-ref> --apply --format json`

4. Treat a successful apply receipt as the batch result. If the command instead
   returns without a trusted receipt, follow the same-turn status resolution
   above before replying. Do not leave an immediately provable commit
   unresolved, and do not retry when the proof conditions are incomplete.
5. Confirm a bounded, representative selection through canonical `event list`
   or `show` reads, covering the imported date range when practical. Do not
   claim a full readback count if the query limit sampled only part of a large
   import.
6. Tell the member how many workouts were created, skipped, or updated, the
   mapped date range, any deliberately ignored rows, and any replay limitation.
   Never expose internal ids, raw rows, temporary paths, or bookkeeping jargon.
