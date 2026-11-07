# Meal thumbnail generation-chain evaluation

Status: completed
Created: 2026-11-04
Updated: 2026-11-04

## Scope and decision

Evaluate the parent-proposed deterministic generation chain (G) against the
uncommitted durable-pointer design (C), on parent head `dd811e73e0`. Keep the
smallest design that preserves deletion after ambiguous remote effects. No
production mutation, commit, amendment, push, or deployment is authorized here.
The preceding completed durability plan remains historical evidence.

Keep C. G recovers a lost upload response only if maintenance retries before the
meal disappears. The following realistic ordering leaves an unlimited-lifetime
object even at generation zero, without encountering any retired-ID rejection:

1. Thumbnail PUT stores and registers A with `expiresAt: null`, then rejects.
2. Core rolls back. The media publisher has not written the catalogue, so no
   cleanup pointer exists. The canonical meal still has only its original photo.
3. The member deletes the meal before the hourly maintenance retry.
4. Core deletes known attachments; snapshot candidate collection skips deleted
   meals. Neither path invents the missing A pointer or invokes a generation walk.
5. The server sweep selects non-null elapsed expiries, so A remains indefinitely.

Code owners: `meal-photo-files.ts:18` deletes known attachments;
`media-references.ts:464` selects live holders; `runtime-resource-cleanup.ts:123`
selects expired media. `runtime-media.ts:73,93` rejects retired identities, but
this failing trace never retires A. Advancing generations cannot repair it.
A lost response at a higher generation has the same missing-pointer problem.

C makes the pointer durable before any thumbnail registration/PUT, so both retry
and immediate deletion find the same identity. Operation-based thumbnail paths
remain necessary to avoid historical terminal identities from older writers.
Retirement remains permanent. A lost receipt-upload response can mean the receipt
was stored; local rollback cannot prove that an identity was never committed.

## Executable comparison

Added the parameterized bridge regression
`a lost media reply leaves no orphan when the next action is %s`.
It uses real core maintenance/deletion, canonical receipt externalization, receipt
storage, snapshot reconciliation and the snapshot bridge. The first remote PUT
stores bytes with unlimited lifetime and then rejects. Final assertions inspect
the entire media store after deletion and pruning.

| Source under test | Maintenance retry before deletion | Deletion before maintenance retry |
| --- | --- | --- |
| Exact dd811e73e0 production sources | Fail: one object remains | Fail: one object remains |
| Deterministic g0 precommit-upload path | Pass | Fail: one object remains |
| C | Pass | Pass |

For the middle experiment, temporarily restored the original photo-SHA filename
and precommit meal upload. No retirement rejection occurs, so higher-generation
handling cannot affect either trace; this is a test of G's actual generation-zero
path, not a claim to have implemented its full protocol. The experiment restored
all production source files byte-for-byte afterward. The original warm/cold lost
PUT tests also failed on dd811e73e0 and pass with C. Incident-shaped receipt
failure, receipt stored but reply lost, partial upload, cold receipt-only recovery
before delivery, and deletion/pruning retry coverage remain in the artifact suite.

## Other G readers and deployment requirements

A repository-wide search found two ID-deriving consumers: the runtime publisher
and the Meals API (`apps/web/src/lib/device-sync/companion-meals.ts:137,149`).
The Meals API derives g0 from the canonical thumbnail path/hash/size, without the
media catalogue. The Worker signs and fetches the exact requested ID; it does not
search generations. G would also need a reader/projection change or bounded
Worker resolution, beyond changing publisher comparisons. Materialization,
receipt replay and pruning already consume stored IDs and do not re-derive them.

New-runtime/old-Worker skew would return the current generic admission error.
A safe G implementation must propagate it without advancing, degrading to the
current failed retry, since unknown errors can include a stored PUT with a lost
reply. Worker and container normally ship together, but that does not fix the
missing cleanup pointer or the Web reader. A finite generation cap also needs an
explicit exhaustion policy after repeated receipt rollback/retirement cycles.

C uses the existing Web registration/admission APIs without protocol or schema
changes. Ship the runner through the normal Cloudflare deployment; no Web or
Temporal deploy or ordering dependency. An old runner ignores pending markers
and can defer thumbnail availability until rollforward; the new parser treats a
missing marker as pending so an older writer cannot permanently erase recovery.
Rollback reintroduces the old writer's failure behavior; it is not a privacy fix.
Canonical bytes and cleanup pointers remain readable across that window.

## Upload timing and first-view latency

| Media kind | Effect of C |
| --- | --- |
| Full meal photos | Unchanged: canonical encrypted receipt/snapshot bytes, no shared-media upload. Original capture-based expiry remains exact. |
| Meal thumbnails | Prepare a pending pointer during canonical publication. Register then PUT only after accepted snapshot or complete durable receipt replay. |
| Inbox images/videos | Existing precommit/publication upload timing unchanged. |
| Ordinary/generated capture media | Existing precommit/publication timing and lifetimes unchanged. |
| Cold integration-ingest payloads | Existing snapshot publication timing unchanged. |

The shared snapshot prune path saves new and prior pointers before pruning, then
writes the final catalogue after remote deletion is acknowledged. It adds one
local catalogue write per snapshot, without moving uploads of other kinds.

For normal idle maintenance, thumbnail bytes become remotely readable later by
the intervening archive/upload/checkpoint work, plus one extra registration
request. The ordinary browser-replica refresh already follows the snapshot
(`hosted-runtime.ts:7286,7631`), so moving the existing PUT across that snapshot
does not itself add the whole snapshot duration to the normal first-view path.
Existing Meals list reads use the encrypted browser replica and existing image
GETs use the Worker/R2 directly; neither acquires a new container wait.
A projection exposing a pending thumbnail before successful delivery can still
produce an image 404 until checkpoint or restore recovery finishes.

Pending recovery runs synchronously before workspace restore returns, including
warm reuse and legacy catalogue entries with no marker. It adds local validation
plus one registration and one PUT per live pending thumbnail, serially, before
foreground work or a refresh waiting for that runtime. Each request uses the
existing configurable commit timeout (default 30 seconds); there is no new total
batch latency bound. A failing request may consume that timeout before recovery
is deferred. Settled entries do not repeat PUTs. Older catalogues incur one
conservative upload per live thumbnail; the existing startup checkpoint saves
completion. No production latency measurement exists for this unshipped change.

## Diff and verification

C versus dd811e73e0 changes 153 source lines: 134 added, 19 deleted, net
115 (including comments). This evaluation added nine source lines to keep newly
uploaded non-meal pointers alongside earlier cleanup pointers before pruning.
A new cold-history regression first failed against C: a failed thumbnail delete
left its new cold-history upload missing from the catalogue. The union write
fixes this without moving non-meal uploads or introducing another state owner.

- `media-references.ts`: durable pending marker, postcommit upload, holder
  validation, legacy marker recovery, retain cleanup pointer until deletion ack.
- `canonical-write-media.ts`: receipt replay reconstructs pending delivery.
- `snapshot-bridge.ts`: upload only after accepted checkpoint.
- `workspace-restore.ts`: resume only after all durable receipts replay.
- `hosted-runtime.ts`: persist restored completion through the existing startup
  checkpoint obligation.
- Core `meal-photo-maintenance.ts`: clarify why operation-based paths remain;
  executable core behavior is unchanged from the parent head.
- Artifact/bridge/cold-ingest tests and architecture/index docs: failure and
  recovery proof, including new uploads during a failed prune.

Commands run in this evaluation:

```sh
# Comparison: red on parent sources, red on G g0 immediate deletion, green on C.
pnpm exec vitest run --config packages/assistant-runtime/vitest.config.ts --no-coverage packages/assistant-runtime/test/hosted-invocation-bridge.test.ts -t 'a lost media reply leaves no orphan'
# 188 passed across five runtime suites (rerun after the final prune fix).
pnpm exec vitest run --config packages/assistant-runtime/vitest.config.ts --no-coverage packages/assistant-runtime/test/hosted-runtime-artifacts.test.ts packages/assistant-runtime/test/hosted-invocation-bridge.test.ts packages/assistant-runtime/test/hosted-runtime-workspace-entrypoint-receipts.test.ts packages/assistant-runtime/test/hosted-workspace-restore-preparation.test.ts packages/assistant-runtime/test/hosted-runtime-cold-ingests.test.ts
# 4 passed.
pnpm exec vitest run --config packages/core/vitest.config.ts --no-coverage packages/core/test/meal-photo-maintenance.test.ts
# 19 passed.
pnpm exec vitest run --config apps/cloudflare/vitest.config.ts --no-coverage apps/cloudflare/test/runtime-media-upload.test.ts apps/cloudflare/test/private-media.test.ts
# 38 passed.
pnpm exec vitest run --config apps/web/vitest.config.ts --no-coverage apps/web/test/device-sync-companion-meals-route.test.ts apps/web/test/changelog-page.test.tsx
# All four passed; Web includes changelog generation.
pnpm --dir packages/core typecheck
pnpm --dir packages/assistant-runtime typecheck
pnpm --dir apps/cloudflare typecheck
pnpm --dir apps/web typecheck
```

## Completion and residual risks

Product UX: Ready for parent review with the startup/availability tradeoff above.
No new member action or model behavior changes. This evaluation adds regression
proof to the existing retention fix, so it needs no separate public changelog.
Existing unknown objects from older writers cannot be found from a missing
catalogue pointer; retroactive repair is not claimed. This scoped change does not
repair other media kinds' lost-upload lifecycles. No retention wait cap changed.

Parent owns the next ReviewGPT round, CI, and shipping. The final runtime suites (188 tests), runtime typecheck and complexity guard
passed after the prune fix. Complexity debt did not increase; snapshot-building
debt decreased by one. Core, Cloudflare and Web checks above passed before that
last internal catalogue change. Documentation and diff checks follow plan closure.
No checks were blocked and no new repository tooling friction required a Frog
entry. All changes remain uncommitted for parent review.
Completed: 2026-11-04
