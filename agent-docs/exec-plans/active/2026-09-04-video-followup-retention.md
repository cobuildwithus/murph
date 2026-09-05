# Encrypted image and video assets independent of workspace snapshots

## Outcome and authority

Implement and land image/video storage that separates durable retention from
runtime materialization. Images and videos remain available for follow-up
questions without forcing their bytes through every workspace checkpoint or
cold restore. The storage owner expires eligible assets while the workspace is
asleep. The task includes both incoming and assistant-generated images/videos,
normal private/group authority, existing consumers, migration, tests, final
review, and PR merge. Production mutation outside the normal merge/deploy
pipeline is not part of this task.

The earlier candidate in PR #2874 retained videos inside the full archive. It is
now draft and superseded by this architecture. Its completion watcher was stopped
on scope redirection. The earlier code and verification remain a useful baseline,
not acceptance evidence for the new storage behavior.

## Architecture evidence and proposed owner

- Current v2 cold restore decrypts/verifies the complete zstd archive before
  extracting it. Full media inclusion couples every cold restore to retained
  media volume.
- Cloudflare already owns a per-workspace encrypted artifact store, fenced
  reads/writes, opaque object paths, key rotation, and deletion primitives.
- Image preparation, analysis, image generation, and file delivery already
  expose materializeWorkspaceArtifacts before opening selected files.
- The existing materializer discovers artifacts through legacy bundles; v2
  restore does not supply a current media-reference inventory.
- Legacy bundle garbage collection deletes artifact objects based on old bundle
  membership. It cannot own new media lifetime unchanged.
- Current retention checks canonical saved references, current/pending work, and
  parser protection inside the workspace. Those facts must have a correct
  storage-side authority before no-wake retention can preserve behavior.

Propose keeping the v2 snapshot for small canonical and runtime state while
putting image/video payloads in individually application-encrypted objects.
Use existing crypto, storage, write-fence, materialization, and cleanup owners.
Keep durable asset identity, logical paths, hashes, and source provenance
separate from a disposable local cache. A compact metadata owner outside the
archive must be sufficient for retention; do not duplicate authoritative
retention state in independently mutable manifests. Choose that owner after
ReviewGPT design review. Do not introduce a virtual filesystem, generic blob
microservice, queue per asset, global hash deduplication, or a compression
pipeline without demonstrated necessity.

## Policy and invariants

- Video default: 72 hours from source receipt/capture; images preserve their
  existing 14-day default. Type policies are independent of cache and snapshots.
- Preserve existing saved-media and active-work protection. Protection must be
  committed before acknowledging a save and revalidated at the deletion owner.
- Store application ciphertext before the first remote durable write; public
  URLs, raw bucket keys, and root encryption keys never enter model context.
- A snapshot omits a binary only after its remote durability and reference
  publication are proven. A failed upload retains a recoverable original.
- No historical-media GET, HEAD, or data-key unwrap merely to restore a workspace.
- Needed assets are authorized, downloaded, decrypted, integrity-checked, and
  installed atomically at the consuming boundary. Concurrent duplicate reads
  share bounded work; failed reads can recover without poisoning later turns.
- Materialized files are disposable cache and remain excluded from later
  snapshots. Missing local content does not mean missing remote content.
- Expiry applies to reads and local cached bytes; old snapshots and replay
  cannot resurrect retired assets. Physical deletion is idempotent and runs
  without decrypting media or waking a container.
- R2 lifecycle rules can provide a coarse cleanup backstop; asynchronous
  lifecycle deletion alone does not enforce exact access deadlines or pins.
- Retention never deletes a still-referenced shared object due to a different
  source record expiring. Deduplication, if reused, remains owner-scoped.
- Existing local-only runtime behavior and ordinary raw-file consumers continue
  to work. Other media types keep their current behavior and can use the same
  policy seam later without an unsolicited migration in this task.

## Product UX plan

Effort: Product change.

- Direct participant: send an image or video, receive ordinary analysis, then
  ask a later question after a cold restore without resending.
- Authenticated group: use group-owned media with existing audience rules;
  private and other-group assets remain inaccessible.
- Generated media: inspect, edit/reference, or resend a previously generated
  image after restore through the same retrieval contract.
- Saved media and active work: explicit preservation survives ordinary expiry;
  pending processing/delivery is not silently broken by background cleanup.
- Expiry and deletion: an expired reference has truthful recovery; a background
  sweep needs no workspace wake, and cached copies cannot bypass expiry.
- Existing workspace: migrate without data loss or per-media startup hydration;
  mixed readers/writers must have an explicit safe deployment order.

Done when these journeys are useful, accurate, and authorized, with zero media
fetches for text-only cold restore, exactly the needed object fetched on first
use, cache reuse thereafter, no media re-upload on unchanged checkpoints, and
retention completing while the workspace remains stopped.

## Design review request

Ask ReviewGPT to independently propose the smallest complete design, critique
the proposal against the attached source, choose the authoritative metadata and
retention owner, and resolve migration/GC and all media-consumer gaps. Request
an actionable implementation plan and evidence-backed objections rather than
an unreviewed code patch. Parent owns the final design and implementation.

## Work and proof

- [ ] Obtain and triage ReviewGPT architecture proposal/critique.
- [ ] Finalize canonical ownership, policy, commit ordering, and compatibility.
- [ ] Implement both image and video remote storage, references, and lazy reads.
- [ ] Implement no-container-wake retention with preservation and replay proof.
- [ ] Cover inbound/generated media consumers, local mode, migration and export.
- [ ] Run focused deterministic tests, typechecks, and synthetic real-Codex
      image/video journeys; inspect actual replies.
- [ ] Measure cold-restore bytes/memory/time, requested-asset calls, unchanged
      checkpoint uploads, and complete provider-input impact where applicable.
- [ ] Update owning architecture/security/retention/deploy docs and changelog.
- [ ] Parent candidate review, exact pushed-head CI and sensitive final ReviewGPT.
- [ ] Archive this plan with final scoped commit, merge, and retire worktree.

## Status

Design request accepted in ReviewGPT; awaiting its architecture response before
dependent implementation. No implementation of the new regime yet. Existing
PR head is c51e3638aa2e8f353a6c332e7921b71755b1580a. Its first-review baseline
remains immutable; later final review requires a fresh full patch because the
sensitive scope changed substantially. Source graph discovery is unavailable
in this checkout; scoped source inspection supplies the evidence.

The design request is separate from final PR review and asks for prose, not a
patch. Its completion marker is MEDIA_DESIGN_COMPLETE. The ignored audit packet
holds the exact capture metadata, source brief, and continuation instructions.
Continue implementation for both media types after independently validating and
triaging the response; do not mistake an architecture response for merge proof.
