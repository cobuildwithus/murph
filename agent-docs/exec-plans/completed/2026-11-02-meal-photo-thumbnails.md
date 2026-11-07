# Private meal thumbnails and full-photo retention

Status: completed
Created: 2026-11-02
Updated: 2026-11-02

## Goal

Keep a private 640px JPEG thumbnail for each surviving meal photo. Delete canonical full photos 90 days after capture and delete meal media on meal removal. Return owner-authorized short-lived URLs in the native Meals API.

## Scope and constraints

PR 1 (#4447) ships first. No iOS changes, member messages, local production mutations, member image/content inspection, or new media service. Reuse canonical writes, encrypted runtime media, idle maintenance, and owner-bound control routes. Production evidence is aggregate metadata only.

## Decisions

- Canonical meal attachments and encrypted hosted media remain the owners. Thumbnail generation/backfill uses bounded resumable idle maintenance.
- Automatic meal closeout must stop immediately destroying full photos; reviewed attachments are distinguished from pending photo review.
- New reader support ships in Web before runtime writers. Existing snapshots return null photos until upgraded through ordinary publication.

## Tasks

1. Finish PR 1 production Web/runtime deployment and counts-only evidence.
2. Implement canonical thumbnail generation, capture-based retention, deletion, and model fallback; prove with synthetic images.
3. Add owner-bound signed delivery and Meals projection/API metadata without exposing storage paths.
4. Integrate bounded maintenance and encrypted-object lifecycle; verify restart and deletion behavior.
5. Update iOS API owner and accurate privacy retention row; review assistant journey and changelog applicability.
6. Focused tests/typechecks, parent review, ReviewGPT, exact-head CI, merge, Web/runtime deploy and live verification.

## Risks and mitigations

- Legacy full images may already have been destroyed by closeout. Leave photo null; never invent media or associations.
- Image conversion or unavailable media must not block other backfill candidates. Retain bounded progress and retry evidence.
- Signed URLs are bearer capabilities. Mint only after owner authority checks, expire quickly, and read the existing encrypted object so deletion revokes delivery.
- Canonical format changes require a compatible Web reader before runtime publication; record the rollback floor.

## Verification

Use synthetic JPEG/PNG images with metadata to prove orientation, size, stripping, retention boundary, retry, deletion and model thumbnail reads. Run affected core/query/runtime/Web/Worker tests and typechecks. Verify protected deployment identities and aggregate maintenance results without inspecting member content.

## Implementation and evidence

- PR 1 merged before this work; Web and protected Cloudflare deployment succeeded.
- Core owns thumbnail generation, bounded resumable backfill, 90-day full-image retirement, and cleanup of historical hide-only deletions. Metadata-only tombstones preserve immutable references; image bytes and encrypted media objects are retired.
- Owner-only Meals reads mint five-minute bearer capabilities against existing encrypted media. No new service, store, table, or foreground model call.
- Automatic closeout records review completion; a thumbnail maintenance revision cannot masquerade as same-occurrence retry evidence. Legacy retry evidence remains accepted.
- Synthetic core, encrypted receipt replay, selected-page API, capability expiry/deletion, CLI, closeout selection and idle-maintenance proof passed. A real local-subscription gpt-6.1-sol journey viewed the surviving thumbnail, edited once, and created no duplicate; reply review Ready.
- Core and hosted-execution emitted builds and affected typechecks passed. Complexity and log guards passed; new functions remain at or below the threshold.
- Initial provider-input measurement: ordinary individual/group requests unchanged in bytes; scheduled meal closeout adds 105 bytes. Exact model-token counts unavailable because no matching tokenizer is configured.
- The iOS contract and privacy policy describe at-rest encryption, five-minute bearer URLs, original-import fallback for historical capture metadata, and asynchronous retention/deletion targets. No end-to-end claim.
- PR #4455 carries final exact-head CI, ReviewGPT and deployment evidence. Final external gates remain mandatory before merge/deploy; no production backfill-completion claim is made in this plan.

## Operational limits

Backfill runs in normal maintenance and resumes through existing retention wakes; inactive vaults wait for runtime work. Already-purged source images cannot be reconstructed. Production upload receipts alone cannot establish the denominator of surviving canonical meals; a full counts-only vault census remains unverified rather than reporting receipt counts as meal coverage.
Completed: 2026-11-02
