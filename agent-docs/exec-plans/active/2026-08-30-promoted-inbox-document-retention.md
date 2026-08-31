# Retire Promoted Inbox Document Duplicates

Status: active
Created: 2026-08-30
Updated: 2026-08-30

## Goal

- Bound duplicate document bytes under `raw/inbox/**` by extending the existing inbox attachment-retention owner after a durable canonical promotion exists.

## Success criteria

- An aged inbox document is retained unless its exact bytes have a canonical promoted owner under `raw/documents/**` and no active durable reference still protects the inbox path.
- A proven promoted duplicate is removed through the existing atomic retention/tombstone path.
- Media retention, unpromoted documents, mismatched copies, referenced attachments, recent attachments, and SQLite snapshot policy remain unchanged.
- Focused tests, the owning package typecheck, required reviews, and exact-head CI pass.

## Scope

- In scope: inbox attachment-retention classification, proof of canonical document promotion, focused tests, and the durable vault-layout/file-count contracts.
- Out of scope: snapshot-time deduplication, content-addressed storage, hardlinks, shorter media retention, integration-ledger pruning, automation retention, and SQLite portability.

## Constraints

- Keep deletion inside the existing inbox-retention owner and its canonical lock/tombstone transaction.
- Fail closed when source metadata, canonical promotion evidence, bytes, path ownership, or references are ambiguous.
- Preserve the current grace period and all existing protection rules.
- Add no dependency, service, index, queue, or second retention format.

## Risks and mitigations

1. Risk: deleting an unpromoted or divergent document.
   Mitigation: require an exact canonical document owner plus byte-size and SHA-256 agreement before eligibility.
2. Risk: deleting bytes still named by durable state.
   Mitigation: reuse the existing protected-reference inventory and atomic retention revalidation.
3. Risk: partial promotion or cleanup interruption.
   Mitigation: retain the inbox source until canonical promotion is already durable; use the existing append-tombstone-and-delete batch.

## Tasks

1. [x] Trace document promotion, exact-source proof, lazy restore, and retention ownership.
2. [x] Implement the narrow eligibility extension and focused regression coverage.
3. [x] Update durable contracts and run focused verification/typecheck.
4. [ ] Complete required specialist and final review gates, commit, push, and close this plan.

## Decisions

- Preserve the existing 14-day grace period instead of accelerating cleanup for recent promoted media.
- Reuse the existing monthly attachment-retention ledger with a document-specific tombstone variant instead of adding a second owner or file family.
- Require the capture's default promotion metadata as a lightweight eligibility prefilter, then reuse Core's full live exact-source audit/event/manifest/artifact proof under the existing canonical lock.
- Accept any matching live exact owner while preserving Core's deleted-source fence; same bytes alone never prove promotion.
- Keep the historical `inbox_media_retention` orchestration mode so this storage cleanup adds no scheduler or runtime state.
- Admit promoted documents through the existing retention batch limits and verify all admitted byte receipts from one transient audit/event ledger snapshot. This removes repeated vault-wide reads without adding a cache, cursor, index, or persisted state.

## Verification

- Passed: contracts full package tests and artifact verification (42 files, 347 tests).
- Passed: Core exact-source regression suite (1 file, 8 tests).
- Passed: inbox attachment-retention regression suite (1 file, 28 tests).
- Passed: contracts, Core, and inboxd typechecks.
- Passed: Core and contracts builds plus regenerated contract artifacts.
- Passed: `git diff --check` before review-candidate commit.
- Passed: post-review Core full package suite (49 files, 835 tests) and focused batch-isolation proof.
- Passed: post-review inboxd full package suite (21 files, 220 passed, 3 skipped) and focused one-proof-per-pass lazy materialization proof.
- Passed: hosted lazy snapshot -> materialize -> retain -> checkpoint -> restore -> rebuild -> validate journey.
- Passed: post-review Core, inboxd, and assistant-runtime typechecks.
