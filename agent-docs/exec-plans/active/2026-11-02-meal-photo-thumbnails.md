# Private meal thumbnails and full-photo retention

Status: active
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
