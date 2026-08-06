# R2 binding workspace-snapshot restore

Status: active
Created: 2026-08-06
Updated: 2026-08-06

## Goal

- Restore encrypted hosted workspace snapshots through the existing same-machine
  container outbound handler and Worker R2 bindings instead of issuing a
  presigned GET to the publicly routable S3-compatible endpoint.

## Success criteria

- Presigned PUT remains unchanged.
- A new internal-only snapshot object-read route preserves the current runtime
  write fence, ref, namespace-key, object-size, checksum, and metadata checks.
- The Worker streams the encrypted R2 body without buffering or transforming it;
  cancellation, bounded reads, and one full replay-safe retry remain intact.
- Existing presigned GET remains temporarily available for old runner bundles,
  while the current runner uses the binding route and accepts the existing
  prepared-restore payload shape during the compatibility release.
- Focused tests, Cloudflare typecheck, and docs verification pass.

## Scope

- In scope: Cloudflare snapshot transport/outbound/R2-cutover code, snapshot
  restore preparation, focused tests, and architecture/security/reliability/
  deploy documentation.
- Out of scope: telemetry schemas, assistant-runtime workspace/maintenance
  behavior, hosted-execution latency contracts, snapshot upload transport,
  deployment, merging, and later compatibility cleanup.

## Constraints

- Technical constraints: use the existing `workspace-snapshots.worker`
  `outboundByHost` boundary; derive the exact object key; never buffer, clone,
  decrypt, decompress, or log the object body in the Worker; retain source/
  destination miss-only fallback and full restore replay.
- Product/process constraints: work only in the guarded task worktree, preserve
  unrelated changes, use `apply_patch`, publish an open review PR, and do not
  merge or deploy.

## Risks and mitigations

1. Risk: Worker/container version skew breaks old or new restores.
   Mitigation: add the binding route while retaining `/presign-get` and the
   existing prepared payload shape for this release; document later cleanup.
2. Risk: streaming through a Worker buffers large snapshots or leaks encrypted
   bytes into logs.
   Mitigation: return the R2 `ReadableStream` directly with fixed headers and
   test first-byte streaming, cancellation, and absence of body reads.
3. Risk: cutover fallback reads the wrong bucket or performs HEAD plus GET.
   Mitigation: reuse the existing phase-ordered cutover bucket `get`, which
   consults the fallback only after a definitive primary miss.

## Tasks

1. Add the internal binding-backed object-read route and exact validation.
2. Switch current snapshot restore to the new route while retaining old-server
   and old-runner compatibility surfaces.
3. Add focused stream, integrity, cutover, retry, and compatibility tests.
4. Update live architecture, security, reliability, deploy, and app docs.
5. Run focused verification, inspect the diff and line shape, and publish the
   candidate through the required ReviewGPT and exact-head CI gates without
   merging or deploying.

## Decisions

- Keep presigned PUT because large snapshot uploads must bypass Worker request
  body limits.
- Keep data-key unwrap separate from the streamed encrypted object response.
- Defer deletion of `/presign-get`, GET signing, locator HEAD logic, and the
  prepared `getUrl` field to the later compatibility cleanup release.
- Mark every response handled by the current object route. An unversioned
  non-OK response identifies an older Worker/proxy and permits the fenced
  compatibility path; a versioned current-Worker error fails closed.
- Treat a prepared URL as compatibility-only. The prepared data key remains
  usable for the binding route even when that URL is expired, while fallback
  requests a fresh presign instead of attempting the stale capability.

## Verification

- `pnpm --dir apps/cloudflare typecheck` passed.
- Focused Node Vitest passed 371 tests across runner outbound, runtime platform,
  and snapshot restore preparation, including the parent-added regression that
  proves an asynchronous binding failure is caught and version-marked.
- Focused Node Vitest passed 248 tests across R2 cutover and runner outbound
  interception.
- `pnpm docs:drift` passed after indexing the durable-doc update.
- `git diff --check` passed.
- Parent review changed the object-route dispatch to `return await` so rejected
  binding reads cannot escape the route's version-marking catch and be mistaken
  by a current runner for an old-Worker compatibility miss.
- Direct tests prove the phase-active bucket is tried before the definitive-miss
  fallback, the Worker does not pull the object body before the response is
  consumed, consumer cancellation reaches the source stream, metadata mismatch
  cancels before response, prepared restore takes the binding route, old Worker
  and old runner compatibility remains, and a mid-stream failure replays the
  whole binding-backed restore exactly once.
- No latency number was recorded: the existing hosted-local snapshot scenario
  exercises MinIO's S3-compatible path, not Cloudflare's production
  same-machine Container outbound plus R2-binding topology. Adding a bespoke
  proxy benchmark would not be truthful evidence for this candidate.
