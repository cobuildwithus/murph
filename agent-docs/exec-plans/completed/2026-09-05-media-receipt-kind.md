# Preserve explicit media identity through receipt recovery

The user resumed the accepted round-three finding and requested the smallest
maintainable correction. PR #2874 remains exclusively owned by this session:
the completion child finished without edits, and the clean local/pushed head
matches 5e848ab8568d2626d1b5951744bc3dbffe4e808b.

## Design and Product UX

Carry the catalogue's existing image/video kind in the compact raw receipt.
The receipt reader and catalogue reconstruction use that explicit kind; original
MIME remains descriptive metadata. Do not infer identity independently at the
reader, discard valid generic-MIME videos, or introduce another state owner.
Mixed image/video captures and video-only captures should survive process loss
before the next snapshot and fetch only the selected media afterward.

## Review-cap retrospective

Round three found one accepted review-induced producer/reader mismatch: the
writer omitted generic-MIME video payloads, while the new parser required an
image/video MIME prefix. The earlier three findings are resolved. The root
mistake was reconstructing an already-known identity from incidental metadata.
Use one explicit field across the existing contract and exercise real inbox
persistence plus serialized receipt-log recovery. No new service, queue,
fallback state machine, or compatibility layer is warranted for this unmerged
contract. The user's continuation instruction authorizes this narrow fix and
completion; finish parent review, verification and CI before a further review
decision under the three-round cap.

## Work and proof

- [x] Reproduce generic/missing-MIME mixed media through the real inbox owner.
- [x] Correct writer, contract, parser and replay; retain metadata-only restore.
- [x] Run focused tests/typechecks, inspect all receipt producers, and verify
      ordinary video and no-store controls.
- [ ] Resolve current-base documentation conflict and diagnose remaining CI.
- [ ] Commit/push the stable candidate; complete the routed review and CI gates
      before merging and retiring the worktree.

The new composed test reproduces receipt-recovery failure for mixed generic and
missing MIME, and eager payload replay for a generic-MIME video alone. After the
fix, all five ingress/storage cases pass, including explicit video/mp4 and
no-media-store controls. The real email normalizer and inbox persistence owner
write a receipt log plus a later note; cold restore recovers both without media
reads, then the selected video materializes once. Core's 44 receipt tests and
runtime's 13 artifact tests pass; both package typechecks pass.

Parent review confirms the only mediaRef producer is the externalizer. It now
copies kind from the same catalogue used for object identity, and the reader
uses it directly. Removing the MIME gate also makes video-only generic inputs
eligible without duplicating media classification. Text-only writes retain
their early return. No compatibility layer is needed for the unmerged field.

Implementation is complete; current-base reconciliation, exact-head CI and the
continuation review remain external completion gates. Earlier Web CI failures
were a build-worker heap exhaustion and a stale migration-guard heap assertion;
neither is in the media change's authored paths. Diagnose against the current
base rather than copying unrelated build changes into this fix.
Status: completed
Updated: 2026-09-05
Completed: 2026-09-05
