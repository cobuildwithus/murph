# CLI read envelope unification

Status: completed
Created: 2026-03-13
Updated: 2026-03-13

## Goal

- Converge CLI read outputs on one stable envelope so generic reads and health CRUD reads expose the same machine-friendly outer shape.

## Success criteria

- Shared CLI contracts define one canonical read-entity shape with `id`, `kind`, `title`, `occurredAt`, `path`, `data`, and `links`, while preserving `markdown` where available.
- Generic `list` and noun-specific read lists return `{ vault, filters, items, count, nextCursor }`.
- Health CRUD `show` and `list` stop returning raw payload envelopes and instead emit the canonical read entity shape.
- Existing lookup semantics stay intact for slug, `current`, and noun-specific lookup flows.

## Scope

- In scope:
- shared CLI read contracts and health read method types
- health query envelope normalization
- noun-specific provider/event/experiment/document/meal/sample/audit read-list item normalization where they already use the shared show/list surfaces
- focused CLI regression coverage for the new envelope shape
- Out of scope:
- command routing or lookup-option renames
- docs or smoke fixture updates unless the implementation forces them
- non-read write-result contracts

## Constraints

- Preserve the active helper-to-usecase cutover instead of reviving deleted legacy helper bodies.
- Work on top of overlapping edits in `health-cli-descriptors.ts` and shared CLI files without reverting adjacent changes.
- Keep the change machine-composability focused; do not broaden into unrelated binding-layer or selector-normalization work.

## Risks and mitigations

1. Risk: health noun-specific reads currently depend on raw query record shapes that differ by noun.
   Mitigation: map those records into the canonical entity shape in one place and keep noun-specific data under `data`.
2. Risk: several custom list commands use local result schemas that only expose summary items today.
   Mitigation: widen the shared `listItemSchema` first, then update local mappers and schemas together so list commands stay consistent.
3. Risk: overlapping active rows are already reshaping helper files into `usecases/*`.
   Mitigation: patch the current `usecases/*` implementations and only touch the thin legacy re-export files when strictly necessary.

## Tasks

1. Update shared CLI read contracts and health method envelopes.
2. Normalize health and noun-specific list/show mappers to emit the canonical entity shape plus stable list envelopes.
3. Update focused CLI tests for the new shape.
4. Run required verification and completion-workflow audits, then clear the ledger row and commit only touched files.
Completed: 2026-03-13
