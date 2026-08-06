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
4. Risk: the binding request serializes behind data-key unwrap and regresses
   the prior path's overlap, or an aging compatibility URL outlives its intended
   request budget.
   Mitigation: acquire the first binding response beside unwrap while keeping
   its body backpressured; cancel it if unwrap fails, reacquire on full replay,
   revalidate URL lifetime before every legacy GET, and carry one absolute
   expiry-derived deadline across response headers and body drain.
5. Risk: a transient Worker-to-R2 binding rejection is converted into a
   version-marked HTTP 500 and bypasses the existing transport retry.
   Mitigation: classify only current-version object-route 5xx responses for the
   existing one-shot replay, reacquire a fresh write fence, and keep every
   compatibility, authority, integrity, timeout, and cancellation failure on
   its existing fail-closed path.

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
- Start first-response acquisition beside data-key unwrap, as the former
  presign path did, but do not consume the response body until the key is
  available. A transport replay acquires a new response rather than reusing a
  rejected or partly consumed body.
- Defer deletion of `/presign-get`, GET signing, locator HEAD logic, and the
  prepared `getUrl` field to the later compatibility cleanup release.
- Mark every response handled by the current object route. An unversioned
  non-OK response identifies an older Worker/proxy and permits the fenced
  compatibility path. A current-version 5xx replays the binding route once
  without compatibility fallback; other current-Worker errors fail closed.
- Treat a prepared URL as compatibility-only. The prepared data key remains
  usable for the binding route even when that URL is expired, while fallback
  rechecks the URL immediately before every GET and requests a fresh presign
  instead of attempting a capability inside the safety window. Header wait and
  body drain share the same absolute expiry-derived deadline.

## Verification

- `pnpm --dir apps/cloudflare typecheck` passed.
- Focused Node Vitest passed 400 tests across runner outbound, runtime platform,
  snapshot restore preparation, R2 ticketing, and local snapshot behavior,
  including the parent-added regression that proves an asynchronous binding
  failure is caught and version-marked. The two directly changed suites passed
  361 tests after the final remediation.
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
- The merged R2 read-latency fields remain attempt-local after the binding
  transport change: the header timer covers the final successful binding
  `POST` or compatibility `GET`, body timing is published only after valid EOF
  and successful restore, and failed replay attempts cannot leak their spans.
- No latency number was recorded: the existing hosted-local snapshot scenario
  exercises MinIO's S3-compatible path, not Cloudflare's production
  same-machine Container outbound plus R2-binding topology. Adding a bespoke
  proxy benchmark would not be truthful evidence for this candidate.
- Preliminary ReviewGPT correctly found that the first draft serialized object
  acquisition behind unwrap and that legacy fallback could reuse an aging URL
  with a reset body deadline. The remediation restores concurrency, cancels an
  abandoned response on unwrap failure, reacquires on either pre-header or
  mid-stream retry, refreshes stale compatibility capabilities, and tests the
  version/fallback matrix. ReviewGPT's requested production-topology canary is
  intentionally not run because this task forbids deployment; candidate
  latency therefore remains an explicit evidence gap rather than a claimed
  measured win.
- Independent remediation review found that the first concurrency fix moved the
  historical `objectFetchMs` boundary ahead of unwrap. The final shape keeps
  acquisition concurrent but starts that legacy critical-path metric after key
  resolution; deterministic timing coverage proves the unwrap interval is not
  double-counted. Additional tests cover a mid-stream retry whose prepared URL
  ages into the safety window, a single absolute compatibility deadline across
  headers and body, and caller cancellation with no retry.
- Final ReviewGPT round 1 found that a current-version 5xx from a rejected
  binding read did not reach the existing replay owner because HTTP-status
  errors were deliberately excluded from transport retries. The correction
  gives that exact marked response its own replay-safe error type. Cross-boundary
  tests prove the first real binding read rejects and is version-marked, the
  runner issues two internal object POSTs with a newly read fence, no presign
  fallback occurs, the second stream restores atomically, and no partial root
  survives.
- Final ReviewGPT round 2 passed the production correction and identified two
  stale prepared-restore assertions outside the earlier selected Vitest
  project. Running the owning platform bucket reproduced both failures. Their
  expectations now prove the binding-specific 500 and two fresh internal
  object reads, with no prepared URL use; all 19 preparation tests pass.
