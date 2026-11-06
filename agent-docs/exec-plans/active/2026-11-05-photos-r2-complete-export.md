# Photos in encrypted R2 and complete workspace exports

Status: active
Created: 2026-11-05
Updated: 2026-11-05

## Goal

Stop carrying meal and measurement photos in the encrypted workspace archive that
every cold start restores and every checkpoint rewrites. Hold them as encrypted
member-scoped objects in the existing hosted media store, fetched only when read.
Make the full-workspace export contain everything it promises.

The 90-day full-size meal photo retirement from #4455 is unchanged: the owner
confirmed full-size photos stay on that policy. This changes where bytes live
during their life, not how long they live.

## Why

- Only `raw/inbox/**` and `raw/captures/**` media leave the archive today. Meal
  thumbnails are uploaded but also stay in the archive, so they are stored twice.
  `publishHostedWorkspaceMediaReferencesForSnapshot` says why: meal CLI and native
  image tools read local paths.
- Automatic iPhone meal capture makes the 90-day window the growth risk. Several
  photos a day for 90 days sits in every restore. The retirement clock bounds it
  but does not take it off the restore path.
- A full-workspace export is a model-built ZIP of local files. Externalized files
  are absent locally, so they are silently omitted while the tool description
  promises all files. `2026-11-02-ingest-cold-storage` already says an exporter must
  call the materializer first; nothing does. Moving photos out widens this gap, so
  the export fix ships first.

## Design

Reshaped by plan review (see Review outcome). Four PRs, in order.

### PR 1: materialization correctness (no prompt change)

- Materialization must not supersede a canonical privacy operation. Authorize reads
  from the current canonical artifact identity, inside the existing flow, for exact
  and bulk requests. Cleanup pointers stay, but they do not authorize a read.
- Expiry may only evict bytes identified as the referenced cached object.
- `runMealPhotoMaintenance` materializes only when it must create a thumbnail.
- One result-path contract at the host/engine port, with authoritative per-path
  outcomes and cancellation. Fixes the rooted/bare key mismatch.
- `send_vault_file` preparation and approved delivery hydrate absent bytes through the
  shared reader, on both transports, without refreshing the approved identity.
- Delete `compareHostedEventRevision` for `compareEventRevisionPriority`.

### PR 2: `materialize_vault_media` and complete exports

- One host tool, gated like `send_vault_file`, enforcing vault-relative scope. Takes
  exact `paths`, or `all: true` over the catalogue including cold ingest months.
- Reports outcomes from PR 1. An unverified local file is never reported as restored.
- Export guidance: call it before archiving and tell the member about anything
  unavailable. A ZIP over the 100 MiB cap fails truthfully, and files are never
  dropped to fit.

### PR 3: preserver release (no new uploads)

- One validated descriptor parser in the runtime-state catalogue owner, reused by
  runtime publication and core. Includes `raw/measurements/**`.
- Upload eligibility and preservation are separate decisions. Measurement references
  survive by canonical retained-artifact ownership, including deleted events. Meal
  references follow explicit photo retirement.
- One retained-artifact resolver for closeout and validation. Local bytes must still
  pass local integrity. When absent, only a settled descriptor matching canonical path,
  hash, size, kind and ownership counts. Pending or obsolete references never do.
- Pending semantics generalized here, so older runners never see an unknown state.

### PR 4: producer release (only after PR 3 is on every runner)

- Discover eligible photos during a checkpoint and persist them as pending, bytes
  still inline: live event, verified local bytes, at least 7 days old, and for meals
  `photoThumbnail` present.
- Release to the bounded uploader only after that checkpoint is accepted, or from
  committed state on a later idle pass.
- Reuse the pending lifecycle, with thin holder and expiry inputs: bounded attempts,
  deadline, retry cursor, ambiguous-outcome recovery.
- Exclude bytes only after settlement is recorded in a later checkpoint.
- Delivered thumbnails leave the archive the same way.

## Review outcome

ReviewGPT architecture review, 2026-11-05. All seven findings were checked against the
code and accepted.

1. P1 accepted, PR 1. Materialization selected by catalogue path alone, so an entry
   could restore an image over a retirement tombstone or delete the tombstone. Latent
   today, and the bulk export in the original design would have exposed it.
2. P1 accepted, PR 3. `deleteEvent` strips photos only for meals. Measurement deletion
   retains raw evidence, while the collector skips every deleted event, so sharing one
   list would prune a retained sole copy.
3. P1 accepted, PR 3. `normalizeHostedMediaCataloguePath` omits `raw/measurements/**`,
   and "catalogued means present" was too weak for closeout and validation.
4. P1 accepted, PR 1. The materializer returns rooted keys and the image resolver looks
   up bare paths, so a rejection could be missed.
5. P1 accepted, PR 1. Secure-file preparation and approved delivery both read local
   bytes with no hydration, so a checkpoint during approval could strand a send.
6. P1 accepted, PR 4. The original "upload at checkpoint, stay inline on failure" could
   orphan an object after a lost response. Replaced with the pending lifecycle and an
   acknowledged-checkpoint boundary.
7. P2 accepted, PR 1. The private revision comparator omits the shard tie-breaker.

## Encryption and safety

No new crypto or storage. The existing store already provides AES-GCM with a random
12-byte IV per object, an HKDF scope key from the member's root key, AAD binding
member, media id, kind, SHA-256 and size, opaque hashed object paths, verified reads
and the account-deletion prefix sweep. Bytes are re-verified on every read.

## Risks and mitigations

1. **Older runner destroys photos.** Old `prepareHostedWorkspaceMediaReferences`
   rebuilds entries from candidates only, then deletes anything else from the store.
   Mitigation: split preserver from producer, same as cold ingest. B2 may ship only
   after B1 has fully replaced older runners, and rollback floor after B2 is B1.
2. **Reconcile prunes an uploaded photo.** Mitigation: preservation is separate from
   upload eligibility, with a test that a sparse checkpoint keeps settled references.
3. **Exclusion before durable upload.** Mitigation: intent is durable before any PUT,
   and bytes leave only after settlement is recorded in a later checkpoint.
4. **Object expires before retirement runs.** Mitigation: thumbnail is required
   before upload, so retirement needs no bytes. Expired reads return unavailable.
5. **Checkpoint latency from backlog.** Mitigation: bounded uploader off the
   checkpoint path, never on foreground.
6. **Model cannot find an old photo.** Mitigation: tool description says when to call
   it. Prove with a real-Codex journey.
7. **Group context reaches private media.** Mitigation: private-conversation gating.

## Out of scope

- Voice notes in `raw/meals/**`. The store has no audio kind.
- Changing the 90-day policy, re-encoding photos, rewriting raw evidence.
- Excluding `query.sqlite` from exports.

## Verification

- Focused tests for each risk above, including mixed-version reconcile.
- Real-Codex journeys: full export includes externalized files; old photo is viewable.
- Provider input measurement for the tool and guidance change.
- Hosted-local restore proof that an externalized photo is absent from the archive
  and readable on demand.
- Archive size before and after on a synthetic photo-heavy vault.
