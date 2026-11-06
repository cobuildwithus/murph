# Photos in encrypted R2 and complete workspace exports

Status: active
Created: 2026-11-05
Updated: 2026-11-06

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


## PR 1 local implementation — 2026-11-06

Scope: findings 1, 4, 5 and 7 only. One local commit; no push, PR, deployment,
new tools, tool-description changes, upload admission changes, or snapshot
exclusion changes. This plan remains active for PRs 2–4.

### Cause, correction and proof

- **Finding 1:** the old materializer selected catalogue paths without checking
  the current artifact, renamed downloaded bytes over that path, and removed
  expired paths unconditionally. Core now checks the canonical raw manifest's
  owner, path, hash, size, media type and non-tombstone role. Materialization
  checks before fetching and again under the canonical write lock before
  installation. Expiry removes only bytes matching the referenced cached object.
  The read path never removes cleanup pointers. Tests cover exact and batch
  requests after deletion and receipt-only recovery, expired full-photo
  pointers, and deletion committing during a fetch; tombstone bytes and manifest
  identities remain unchanged. The existing cleanup owner still retires objects.
  Thumbnail hydration moved into the existing missing-thumbnail branch, outside
  its image-decoding catch. Metadata-only retirement and historical deleted-meal
  cleanup prove zero materialization calls.
- **Finding 4:** engine image/video consumers previously tested bare paths
  against rooted runtime results, and best-effort attachment readers ignored
  rejections. There is now one engine-owned result/options contract, reused by
  the host: rooted success paths and authoritative per-path unavailable reasons
  (`missing`, `expired`, `integrity`, `size`, `transport`, `obsolete`). All test
  doubles and consumers use it. Signals reach remote reads and installation;
  invocation failures remain typed control flow through best-effort and dynamic
  tool handlers. Real runtime/engine composition tests reject a valid-looking
  wrong local PNG when the remote copy is missing or corrupt, and cover mixed
  success, size rejection, expiry, transport failure, cancellation and owner
  loss. Explicit root-qualified requests preserve literal vault directory names
  and colon-bearing filenames. Existing image, video, evidence and secure-file
  caps are passed by their owners; the generic port has no invented universal cap.
- **Finding 5:** preparation and approved delivery previously read only local
  bytes. Both now use the same ordinary-vault reader with hosted materialization
  and the existing 100 MiB secure-file cap. Generated-delivery ownership is
  unchanged. Synthetic Telegram and Linq tests prepare an approval from a
  catalogue-only photo, snapshot without cached bytes, restore, approve and
  dispatch. Exact approved bytes reach the transport once. Expired, missing and
  changed objects prevent delivery, and approval is requested only once.
  Telegram tests inspect the multipart document bytes; Linq tests inspect the
  transport's byte-loader boundary. Approval identity/destination checks and
  Telegram's durable non-idempotent sending-claim ordering remain in place.
- **Finding 7:** removed the timestamp-only private comparator. Inventory now
  retains shard paths and delegates to `compareEventRevisionPriority`. Equal
  revision/timestamp fixtures prove canonical reads, photo maintenance and media
  reconciliation choose the same deleted winner and prune the losing thumbnail.
  Historical raw-inbox evidence still survives across losing/deleted revisions.

### Product and review disposition

Outcome: retained files can be delivered after a cold restore, while retired or
unverified bytes cannot masquerade as a successful read.
Reaches: private Telegram and Linq secure-file requests, image/video readers,
attachment evidence, and bounded meal maintenance.
Proof: synthetic composed runtime tests through the transport boundary; **Ready**
for this local prerequisite. No real provider messages or member data were used.

All four scoped findings are accepted. The review's snapshot-exclusion change
in finding 1, exporter tool/ZIP/live-export journey in finding 4, and findings
2, 3 and 6 remain in the later PRs explicitly assigned by the brief. They are
not rejected. In particular, measurement catalogue parsing/upload eligibility
is not expanded here. No prompt/provider-input schema changed; model-directed
export proof belongs to PR 2. No release note or external ReviewGPT/CI run is
published for this local-only commit. A pushed-head review is outside this task's
explicit no-push/no-PR boundary.

### Verification commands and results

Each executed lane captures `EXIT=$?` and returns that exit status; no piped test
command is treated as proof. Results below are local, not CI or deployment proof.

Hydration (all exit 0): `pnpm install --prefer-offline`,
`pnpm build:workspace:incremental`, `pnpm --dir packages/health-commons generate`,
`pnpm --dir apps/web prisma:generate`. Workspace build was repeated after the
shared type/consumer changes.

Tests use `pnpm --dir <package> exec vitest run --config vitest.config.ts
--no-coverage <files>` unless a row gives another invocation.

| Lane | Files / command selection | Result |
| --- | --- | --- |
| Core full suite | Initial `pnpm --dir packages/core test -- test/meal-photo-maintenance.test.ts` ran the full suite because of the extra separator. | Exit 0; 67 files, 1,078 passed, 1 skipped. |
| Core final maintenance | `test/meal-photo-maintenance.test.ts` | Exit 0; 4 passed after moving hydration into the thumbnail branch. |
| Engine focused | `image-reference-resolver`, `assistant-codex-analyze-video-tool`, `assistant-vault-file-send`, `assistant-attachment-evidence-model`, `conversation-attachments`, `assistant-automation-prompt-builder`, `assistant-codex-group-tool`, `assistant-codex-generate-image-tool`, `generate-image-tool`, `dynamic-tools-generate-image`, `assistant-local-service-hosted-tools`, `assistant-local-service-delivery` (`test/*.test.ts`) | Exit 0; 12 files, 433 passed. |
| Engine evidence follow-up | `test/assistant-attachment-evidence-model.test.ts` | Exit 0; 21 passed. |
| Engine dynamic control flow | `assistant-vault-file-send`, `conversation-attachments`, `assistant-codex-group-tool` | Exit 0; 192 passed, including secure-file interruption. |
| Engine remaining consumers | `conversation-attachments`, `assistant-physical-notes`, `assistant-physical-notes-proactive-address` | Exit 0; 42 passed, including image/video owner-loss propagation. |
| Runtime focused | `hosted-runtime-artifacts`, `hosted-runtime-callbacks`, `hosted-runtime-pending-input-protected-idle-maintenance`, `hosted-meal-media-maintenance`, `hosted-runtime-workspace-runner` | Exit 0; 5 files, 569 passed. |
| Runtime exact-path follow-up | `hosted-runtime-artifacts`, `hosted-runtime-artifact-paths`, `hosted-runtime-callbacks` | Exit 0; 370 passed, including the new literal-root-name regression. |
| Vault usecases | `integrated-services-meal`, `meal-list-source` | Exit 0; 4 passed. |
| CLI | `cli-runtime-artifacts`, `cli-expansion-document-meal` | Exit 0; 20 passed. |
| Cloudflare consumer | From repository root: `pnpm exec vitest run --config apps/cloudflare/vitest.config.ts --no-coverage apps/cloudflare/test/container-workspace-restore-preparation.test.ts apps/cloudflare/test/runtime-media-write-cancellation.test.ts apps/cloudflare/test/runtime-platform-artifact-upload.test.ts` | Exit 0; 62 passed. |

Earlier runtime test lanes exited 1 for newly authored fixture timestamp,
shard-name and store-stub setup errors; the corrected composed lanes above pass.
An earlier engine focused lane exited 1 for an obsolete argument expectation;
the final evidence lane passes. The initial Cloudflare command ran from the
package directory and exited 1 with no files found; the root invocation above
passes. Initial complexity exited 1; moving hydration into existing owner
branches and constructing the Linq materializer outside dispatch removed the
regressions. Final `pnpm complexity:diff` and `git diff --check` exit 0.

No new repository friction required a workaround after inspecting Frog's
existing entries. All fixtures and recorded evidence are synthetic.


Final typechecks: `pnpm --dir <package> typecheck` exited 0 for
`packages/core`, `packages/assistant-engine`, `packages/assistant-runtime`,
`packages/vault-usecases`, `packages/cli`, and `apps/cloudflare`.
The final workspace incremental build also exited 0.
`pnpm docs:drift` exited 0. An attempted `pnpm docs:check` exited 254 because
that script does not exist; the declared docs-drift command and diff readback
provide the relevant validation. The authored-diff privacy scan exited 0.

The initial engine invocation also used `test -- <files>`, expanding into the
whole engine suite. It overlapped subsequent edits and reported two assertions
in the attachment-evidence file before termination. That superseded run is
**not passing evidence**: its proven session-owned process tree received
SIGTERM and the wrapper captured exit 143. The final-state attachment-evidence
file passes all 21 tests in a fresh process, and the final focused engine and
consumer lanes above pass. No unrelated process was signalled.


## PR 2 local implementation — 2026-11-06

Scope: the deferred private `materialize_vault_media` tool, complete-export
preparation guidance, and deterministic/live proof only. Keep this plan active
for PRs 3–4. One local commit; no push, PR or deployment.

Outcome: saved media missing locally can be read, and workspace backups restore
catalogued media and cold history before archiving. Unavailable or unverified
files are disclosed; an oversized finished ZIP fails without dropping files.
Reaches: authenticated private conversations admitted by `send_vault_file`;
groups and unverified conversations cannot invoke restoration.
Proof: exact schema/admission/scope, complete catalogue enumeration through the sequential port, composed
runtime mixed outcomes and interruption, valid oversized ZIP rejection, real
Codex archive and old-photo journeys, and first-provider-input ablation.

The catalogue already supports native deferred loading. This low-frequency tool
uses it, adding no resident prompt procedure or flag. The existing catalogue
reader, materialization port, canonical authority and send cap remain owners.
No changes to externalization, upload eligibility or snapshot exclusion.
The architecture's secure-file boundary documents the resulting contract.

Changelog disposition: no public release note for this explicitly local-only,
unpublished slice; the release must describe this member-visible improvement.
External ReviewGPT and exact-head CI require a pushed PR and remain outside the
explicit boundary. Local parent review and focused verification apply here.

### PR 2 result and review

The tool schema is an object with no additional properties and exactly one of
`paths` (1–100 strings, each 1–4096 characters) or `all: true`. Paths must be
normalized vault-relative paths: no absolute paths, traversal, backslashes,
control characters, drive prefixes or workspace root selectors. Literal vault
subdirectories named `vault` or `operator-home`, and colon-bearing filenames,
remain in the vault because the port receives explicit `vault:` keys.
`all` reads the catalogue once at this boundary, including cold ingest months,
and passes the full selection once to the existing sequential materializer.
This avoids re-reading its catalogue for artificial batches. No parallel remote
fanout is added. Exact requests retain their 100-path admission bound.

The response is `{ requested, available, unavailable: [{ path, reason }] }`.
Only authoritative PR 1 outcomes count as available. Reasons are `missing`,
`expired`, `integrity`, `size`, `transport` or `obsolete`; an omitted outcome
fails closed as missing. Abort and owner-loss errors propagate. The real
runtime composition proves that wrong local PNG bytes remain unchanged and
are never reported restored when remote bytes are missing or corrupt.

Parent review: **Ready** for this local slice. Five live scenarios passed on
`gpt-6.1-sol`, local subscription, using production prompts/tool contracts and
synthetic catalogue/materializer/delivery ports. All four archive scenarios
assert one `all: true` call before send preparation, one approval request,
byte-for-byte ZIP contents and unchanged originals. The old-photo journey
asserts one exact-path call, native image viewing and the correct visual answer.
The runtime test separately composes the actual hosted materializer with the
engine result owner; live fixtures do not claim real storage/provider delivery.

The extra incomplete-archive replay caught misleading prose despite passing
its first assertions: the reply said a file was excluded, while the archive
correctly preserved an unverified local copy. The owning guidance now explicitly
distinguishes unrestored from excluded, and the replay rejects that claim.
Two subsequent runs passed with truthful missing-original/local-copy wording.
No source files are dropped or modified to make an export fit the send cap.
The completed, valid oversized-ZIP fixture fails before requesting approval.

### PR 2 provider input

In-fixture ablation removes this tool and replaces only the added export
sentence with the exact PR 1 wording. The synthetic conversation, production
prompt layers and other tools stay identical. Captures use the real App Server
with a scripted `gpt-6.1-sol` provider, excluding only `prompt_cache_key`.
No exact target tokenizer is configured; scripted token usage is not a token
measurement.

| Scope | Component | Base UTF-8 bytes | Head UTF-8 bytes | Delta |
| --- | --- | ---: | ---: | ---: |
| Direct | Complete decoded first request | 136985 | 137309 | +324 (+0.237%) |
| Direct | Registered tool descriptors | 66504 | 67682 | +1178 (+1.771%) |
| Direct | Instructions and turn prompt | 70584 | 70584 | 0 |
| Group | Complete decoded first request | 141082 | 141082 | 0 |
| Group | Registered tool descriptors | 46753 | 46753 | 0 |
| Group | Instructions and turn prompt | 67578 | 67578 | 0 |

Native deferral keeps the tool's full schema out of the first provider request.
No resident prompt or group prompt text changed.

### PR 2 executed lanes

Every test/build/typecheck lane captures `EXIT=$?` before inspecting output and
returns the real status. These are local results, not CI/deployment evidence.
For package tests below, the command prefix is `pnpm --dir <package> exec vitest
run --config vitest.config.ts --no-coverage`.

| Lane | Selection | Final result |
| --- | --- | --- |
| Engine boundaries and adjacent consumers | `materialize-vault-media`, `assistant-vault-file-send`, `assistant-codex-turn-planning`, `assistant-codex-group-tool`, `assistant-local-service-hosted-tools`, `assistant-local-service-delivery`, `system-prompt.dynamic-context` (`test/*.test.ts`) | Exit 0; 7 files, 445 passed |
| Final tool/send boundary recheck | `test/materialize-vault-media.test.ts test/assistant-vault-file-send.test.ts` | Exit 0; 98 passed, including 25 new-tool tests |
| Provider contract conversion | `test/assistant-codex-tool-input-contract.test.ts` | Exit 0; 20 passed, 40 opt-in cases skipped |
| Input measurement | `MURPH_MEASURE_VAULT_MEDIA_INPUT=1` plus the provider-contract file and `-t 'vault media: complete first provider input'` | Exit 0; 2 passed |
| Full hosted tool admission | `MURPH_RUN_REAL_CODEX_E2E=1` plus `test/production-hosted-capabilities.test.ts` (synthetic provider boundary) | Exit 0; 1 passed, 50 tools |
| Runtime real materializer | `packages/assistant-runtime`, `test/hosted-runtime-artifacts.test.ts` | Exit 0; 39 passed |
| CLI consumer | `packages/cli`, `test/cli-runtime-artifacts.test.ts` | Exit 0; 7 passed |
| Cloudflare consumers | From root: `pnpm exec vitest run --config apps/cloudflare/vitest.config.ts --no-coverage apps/cloudflare/test/container-workspace-restore-preparation.test.ts apps/cloudflare/test/runtime-media-write-cancellation.test.ts` | Exit 0; 16 passed |
| Typechecks | `pnpm --dir <package> typecheck` for `packages/assistant-engine`, `packages/assistant-runtime`, `packages/cli`, `apps/cloudflare` | All exit 0 |
| Dependency/build preparation | `pnpm install --prefer-offline`; `pnpm build:workspace:incremental`; `node scripts/assemble-assistant-cli-surface.mjs` | All exit 0 |
| Repository checks | `pnpm complexity:diff`; `pnpm docs:drift`; `git diff --check`; authored-content privacy scan | All exit 0 |

Each live command uses `pnpm test:assistant:live -- --test '<pattern>'`:

| Pattern | Result and reply review |
| --- | --- |
| `an original-file workspace ZIP` | Exit 0; Ready |
| `a full workspace ZIP including member runtime files` | Exit 0; Ready |
| `a complete workspace ZIP from a general backup request` | Exit 0; Ready |
| `real Codex old saved photo e2e` | Exit 0; Ready; green background, white label, 42 g |
| `a disclosed incomplete workspace ZIP` | Initial exit 0 but UX Hold; corrected guidance/replay exit 0 twice, Ready |

Earlier nonpassing lanes: the intentional preimplementation regression exited
1; initial new-test RPC/context fixture mistakes also exited 1, then passed.
Typechecks exited 2 for new fixture typing and later an inferred request-union
shape; explicit request types fixed them, and all four final package checks pass.
The first complexity lane exited 1; using the existing reader list and a typed
ordinary-validation predicate kept dispatcher complexity from growing. A combined
live pattern and an overly qualified pattern each exited 2 before provider work;
unique scenario substrings ran normally. The first hosted-capability parity lane
exited 1 because its generated CLI contract was absent; the documented generator
exited 0 and the parity rerun passed. Frog's existing prepared-runtime/CLI-contract
entry already describes that setup requirement; no new workaround or entry was
needed. There are no unresolved local verification failures.
