# PR 752 ReviewGPT round 2 remediation

Status: active
Created: 2026-07-16
Updated: 2026-07-16

## Goal

- Prevent legacy WHOOP sleep-type metadata enrichment from replacing a newer
  canonical event revision created through the supported event-edit path.

## Success criteria

- A production-path regression proves that a temporal/source-only edit with
  unchanged notes, tags, and links remains canonical during enrichment.
- Untouched legacy sleep rows still receive provider-owned `sleepType`
  metadata; deleted or edited rows remain unchanged; unrelated snapshot
  resources still commit; exact replay remains storage-idempotent.
- Focused owner tests, typechecks, diff/privacy guards, CI, and the next
  ReviewGPT round pass on the exact pushed PR head.

## Scope

- In scope: the narrow legacy WHOOP sleep-type exception in core, its focused
  regression coverage through the supported event-edit owner, verification,
  PR metadata, CI, and ReviewGPT.
- Out of scope: generic device conflict semantics, provider normalization,
  schema changes, unrelated sleep-loop behavior, deployment, and merging the
  PR.

## Constraints

- Preserve the latest canonical event revision as the sole user-facing truth.
- Do not turn the metadata backfill into a generic same-version conflict
  exemption or block unrelated resources in a mixed snapshot.
- Keep package dependencies one-way and place the production-path test in an
  owner that already depends on both the event usecase and core.

## Tasks

1. Reproduce the ReviewGPT finding through the supported edit path.
2. Apply the smallest revision-ownership guard and update focused coverage.
3. Run scoped verification and parent final review; close the plan and commit.
4. Push the correction, start the next ReviewGPT round alongside CI, and
   resolve any further accepted findings without merging the PR.

## Decisions

- Treat any canonical revision newer than the indexed provider revision as an
  edit that the legacy metadata backfill must not replace, regardless of which
  mutable field changed.
- Keep that revision comparison inside the recognized-enrichment preserve path.
  Folding it into enrichment recognition would turn an edited sleep row into an
  equal-version conflict and abort unrelated resources in the same snapshot.

## Verification

- Before the production correction, the new real-vault test reproduced the
  bug: the supported edit was displaced by revision 3 instead of remaining
  revision 2.
- After the correction, that test passed through real query, edit, core upsert,
  provider reconciliation, unrelated-resource commit, and replay paths.
- Pending full focused owner suites, truthful diff-aware verification,
  privacy/diff checks, exact-head CI, and ReviewGPT round 3.
