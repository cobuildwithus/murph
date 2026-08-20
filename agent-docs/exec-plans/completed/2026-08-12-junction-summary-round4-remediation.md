# Junction summary ReviewGPT round-four remediation

Status: completed
Created: 2026-08-12
Updated: 2026-08-12

## Goal

- Resolve the three accepted round-four findings on PR #1702: compare provider facts semantically instead of by capture/version metadata, stabilize same-day menstrual fact identity without ordinals or sensitive strings, and expose an existing-owner recovery path for member/provider conflicts.

## Invariants

- Provider ordering/version and capture metadata never decide semantic equality; their ordering checks remain independent.
- Public member edits remain live and attributed, while unrelated facts from newer complete snapshots continue importing.
- Menstrual fact identities remain bounded, opaque, deterministic, reorder-invariant, and stable when a sibling is inserted or corrected.
- Retained or omitted true edits still produce one provider-neutral typed conflict and byte-atomic behavior.
- Conflict recovery uses existing device-sync status, importer/core, and public mutation owners; no registry, table, queue, state machine, or second reconciliation owner is added.
- “Keep my correction” preserves the manual live revision while advancing the provider baseline; “use connected source” authorizes the current provider revision.
- No full provider timeseries, provider arrays, provider snapshots, or sample rows are persisted.
- PR #1702 keeps `a54a0a10d185c368ad4f04f0678fb84f0fe07f01` as its immutable first-reviewed head.

## Tasks

1. Reproduce and trace the three reviewed failures through real public edit and Junction job paths.
2. Separate semantic event comparison from provider ordering/capture metadata and replace menstrual ordinals with opaque semantic fingerprints.
3. Preserve a safe typed conflict at the device-sync boundary and add retry-safe resolution through existing owners.
4. Update durable docs and PR disclosures, run focused checks, commit, push, and report the exact head without launching ReviewGPT.

## Verification

- Focused core, importer, vault-usecase, device-syncd, hosted runtime, query, and CLI tests.
- Relevant package typechecks and direct Junction job conflict/recovery scenarios.
- Diff, privacy, Frog, package-shape, and current-base merge-tree proof.

## Outcome

- Semantic provider equality now ignores mutable capture and ordering metadata while keeping stable provider-source identity.
- Menstrual fact facets use opaque semantic fingerprints, so reordering or inserting a sibling does not remap existing facts.
- Device sync exposes one provider-neutral conflict code and carries an explicit one-shot member choice through the existing reconcile job into atomic vault reconciliation.
- Focused tests and typechecks cover both retained and omitted member edits, exact retries, sibling updates, assistant choice handling, and the complete hosted transport path.
Completed: 2026-08-12
