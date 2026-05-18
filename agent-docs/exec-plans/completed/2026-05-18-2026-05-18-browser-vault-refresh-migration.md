# Browser vault refresh migration

Status: completed
Created: 2026-05-18
Updated: 2026-05-18

## Goal

- Fix browser-vault freshness so hosted dashboard surfaces never present an old
  replica as current, while keeping browser-vault refresh derived, best-effort,
  non-blocking, and architecturally subordinate to assistant/message runtime
  work.
- Use PR #35 as design evidence, not as a merge target. Salvage its durable
  ideas only where they fit the current simpler architecture.

## Success criteria

- The browser-vault session route marks an existing stale replica as stale and
  returns `refreshPending: true` without blocking the response.
- Missing, unreadable, deleted, and stale browser-vault replicas schedule real
  low-priority refresh work instead of a generic no-op runner nudge.
- Refresh never blocks incoming assistant messages, foreground assistant reply
  effects, mailbox import, runtime wakes, outbox work, or idle checkpoint
  correctness.
- Refresh is background relative to web requests and assistant replies: web only
  requests refresh after responding, assistant/outbox paths never await it, and
  any runtime-side refresh is bounded and aborts/yields when a runtime wake is
  signaled.
- Browser-vault replica source identity is stable across rebuilds that do not
  change canonical query-source content.
- Query-visible deletions can publish a valid empty/current replica so stale
  private dashboard data is not left visible indefinitely.
- Cloudflare remains a thin runner/coordinator. Do not add a browser-vault
  Durable Object, queue, cron, broad side route, generic capability system, or
  second product-control plane.
- The old container `/internal/browser-vault-refresh` side path remains removed.
- Architecture, hosted runtime protocol, tests, and package exports agree on the
  final ownership split.

## Scope

- In scope:
  - Browser-vault freshness and scheduling semantics in `apps/web`,
    `packages/hosted-execution`, `packages/assistant-runtime`,
    `packages/query`, `apps/cloudflare`, and focused tests.
  - PR #35 salvage review for stable query-source hashing, receipt-based dirty
    detection, source-race handling, empty replica publishing, scoped failure
    behavior, and removed side-path tests.
  - Documentation updates in `ARCHITECTURE.md`,
    `agent-docs/references/hosted-runtime-protocol.md`,
    `apps/cloudflare/README.md`, and testing docs if the implementation changes
    the runtime contract or verification surface.
- Out of scope:
  - Merging PR #35 wholesale.
  - Reintroducing the removed detached browser-vault refresh route.
  - A new Cloudflare Queue, Durable Object, cron, Workflow, or browser-vault
    scheduler.
  - A background child/process/proxy-token architecture unless the final design
    review explicitly decides normal runtime idle maintenance cannot satisfy the
    non-blocking invariant.
  - Product UI redesign for experiment pages beyond surfacing correct freshness
    state if required.

## Constraints

- Technical constraints:
  - Browser-vault replicas are derived dashboard sidecars, not canonical
    workspace truth and not workspace checkpoint producers.
  - User-facing/queryable product truth stays in canonical vault records or
    explicit derived materializations, not assistant runtime residue.
  - `apps/web` owns hosted product/control-plane facts and the latest
    `browserVaultReplicaRef` pointer.
  - `apps/cloudflare` owns runner coordination, encrypted object plumbing, and
    callback transport only.
  - `packages/assistant-runtime` owns hosted runtime behavior over the restored
    local workspace.
  - Replica writes must be narrow, capped, encrypted, and ownership checked.
  - Existing active hosted-runner work overlaps `apps/cloudflare/src/user-runner.ts`,
    `apps/cloudflare/src/runner-container.ts`, `apps/cloudflare/src/container-entrypoint.ts`,
    `apps/cloudflare/src/runner-outbound/**`, and hosted runtime docs; coordinate
    before editing those files.
- Product/process constraints:
  - Assistant liveness outranks dashboard freshness.
  - Keep the architecture clean, simple, long-term maintainable, and composable
    with minimal complexity.
  - Same-turn implementation should not happen until the final migration shape
    is discussed and agreed.
  - Preserve unrelated dirty worktree edits and active ledger rows.

## Risks and mitigations

1. Risk: A refresh path runs inside the foreground assistant reply path and
   delays incoming messages or replies.
   Mitigation: Refresh is low-priority maintenance only. Do not call it from the
   assistant phase, provider effect handling, outbox delivery, assistant
   `afterCheckpoint`, or mailbox prompt-preparation path. It must check for
   pending durable demand before starting, use a short timeout/abort signal, and
   yield to mailbox, runtime wake, outbox, provider effect, and checkpoint work.

2. Risk: A maintenance refresh starts after an idle checkpoint, then a new user
   message arrives while the refresh is building or publishing.
   Mitigation: Race runtime-side refresh against the existing
   `RuntimeWakeSignal`. If the wake signal fires before refresh completes,
   abandon the refresh attempt without publishing partial state, return/schedule
   normal runtime work, and let mailbox/assistant processing win. Add a focused
   test that a wake during refresh prevents publish and schedules foreground
   work.

3. Risk: A stale existing replica is treated as fresh forever.
   Mitigation: Centralize freshness in a shared pure helper. Freshness must not
   mean "ref exists"; it must account for source identity, checkpoint/update
   evidence, and a bounded max-age/SLA.

4. Risk: Source identity changes on every refresh and causes unnecessary writes.
   Mitigation: Salvage PR #35's stable canonical query-source hash: sorted
   relative paths, byte sizes, and content hashes only. Exclude mtimes,
   generatedAt, user ids, workspace ids, and `.runtime`.

5. Risk: Query-visible deletions leave old private dashboard data visible.
   Mitigation: Publish a valid empty/current replica when current query-visible
   content is empty or deleted; do not treat empty current content as a failed
   refresh.

6. Risk: Adding a browser-vault-specific scheduler creates another execution
   plane.
   Mitigation: Prefer normal hosted runtime idle maintenance or a minimal
   typed runner demand that reuses existing runner coordination. Add a PR #35
   style background child/proxy token only if explicitly accepted after review.

7. Risk: Deploy skew between web and Cloudflare breaks browser-vault sessions.
   Mitigation: Make consumers tolerant first, keep removed-route responses
   explicit, and stage producer removals after both sides accept the new shape.

8. Risk: Refresh writes bypass expected authority and privacy boundaries.
   Mitigation: Keep replica writes behind existing encrypted browser-vault store
   ownership checks and require narrow tests for unauthorized writes, source hash
   mismatch, oversized replicas, and publish conflicts.

## Tasks

1. Baseline proof and failing regression:
   - Add focused tests proving an existing old `browserVaultReplicaRef` returns
     `freshness: "stale"` and `refreshPending: true`.
   - Add focused tests proving missing/unreadable refs schedule refresh without
     waiting for refresh completion.
   - Add a direct local reproduction note for the May 8 generatedAt symptom.

2. Shared freshness helper:
   - Replace `ref exists => fresh` in `packages/hosted-execution/src/browser-vault.ts`
     with a pure assessment helper.
   - Inputs should include current ref, optional known current source hash, last
     checkpoint/update evidence, current time, and max-age policy.
   - Do not use `workspace.updatedAt` alone as source truth.
   - Web should still serve stale replicas when usable, but mark them stale and
     schedule refresh.

3. Stable query-source hash:
   - Salvage PR #35's `hashCanonicalQuerySources` and
     `isCanonicalQuerySourcePath` into `packages/query/src/vault-source.ts`.
   - Keep `listCanonicalSourceManifest` for diagnostics but do not use mtime as
     replica source identity.
   - Add tests for stable hash ordering, mtime insensitivity, non-query-source
     exclusion, and deletion sensitivity.

4. Runtime-owned dirty detection:
   - Salvage PR #35's receipt-based dirty logic into
     `packages/assistant-runtime/src/hosted-runtime/browser-vault-replica.ts`.
   - Mark dirty from hosted canonical write receipts only when the write affects
     canonical query sources.
   - Ignore raw artifact writes, reuse writes, non-existing deletes, `.runtime`,
     projections, cache, and non-query-source paths.
   - Decide whether dirty state must be persisted under
     `.runtime/operations/browser-vault/refresh-state.json` or can be derived
     from current source hash plus latest published ref. Prefer derived state if
     it avoids a scheduler-like state file.

5. Refresh helper in assistant-runtime:
   - Move the core refresh algorithm out of Cloudflare orchestration and into
     `packages/assistant-runtime`.
   - Build from the restored local `vaultRoot`, compute source hash before and
     after build, discard if it changes, write/publish through the injected
     browser-vault replica port, and update dirty/last-published state only
     after publish succeeds.
   - Accept an abort signal and runtime-wake signal. If aborted or woken before
     publish, skip publish and report "deferred" so the runner can process the
     higher-priority wake.
   - Treat empty current query-visible content as publishable.
   - Enforce the existing 50 MiB cap and best-effort/backoff behavior.

6. Minimal refresh trigger:
   - Preferred path: after successful foreground runtime work and idle checkpoint
     eligibility, run browser-vault refresh as bounded low-priority runtime
     maintenance only if no durable demand is pending.
   - Stale page load should request that same low-priority path, not a generic
     nudge that reads as caught up.
   - Runner demand priority must be:
     mailbox/incoming message > due runtime wake/assistant work > checkpoint
     correctness > browser-vault refresh.
   - Do not hook refresh into assistant phase, assistant `afterCheckpoint`,
     outbox/provider delivery, or mailbox prompt-preparation. If the refresh
     runs inside an existing runtime invocation, it must happen only after
     foreground work and idle checkpoint correctness are settled, and it must
     abort/yield on `RuntimeWakeSignal`.
   - If the normal idle-maintenance path cannot avoid blocking incoming work,
     return to the PR #35 option: warm-container killable background child with
     browser-vault-only authority. Treat this as the heavier fallback, not the
     default.

7. Cloudflare thin-runner integration:
   - Keep Cloudflare responsible for invoking the runtime and providing the
     existing browser-vault replica port.
   - Avoid new browser-vault DO state, queue state, cron, Workflow, or broad
     proxy authority.
   - Remove or repurpose the legacy `scheduleBrowserVaultRefreshForUser` no-op
     route only after the replacement scheduling path is deployed-compatible.

8. Web/session integration:
   - Use the shared freshness helper in the browser-vault session route.
   - Keep response latency independent from refresh execution.
   - For stale known refs, return `not_modified` with stale metadata when the
     client already has that exact ref, so the UI can show stale/pending state
     without unnecessary replica transfer.

9. Docs and verification:
   - Update `ARCHITECTURE.md` and hosted runtime protocol docs to match the
     final shape.
   - Add focused tests across `packages/query`, `packages/assistant-runtime`,
     `packages/hosted-execution`, `apps/web`, and `apps/cloudflare`.
   - Run the required package/app verification lanes and completion audits for
     persisted state, Cloudflare runtime, and trust-boundary changes.

## Decisions

- Use PR #35 as a source of proven sub-designs, not as the implementation to
  merge.
- Default implementation path:
  - Web/shared code owns freshness assessment.
  - Cloudflare observes/schedules a normal low-priority runtime demand and
    supplies the existing browser-vault replica port.
  - Assistant runtime builds and publishes the derived replica under the
    existing runtime write fence.
  - Runtime-side refresh must be a best-effort maintenance step, not part of
    assistant turn admission, reply generation, reply delivery, or outbox
    checkpointing.
  - PR #35's background child/proxy-token model stays a fallback only if focused
    tests prove normal runtime maintenance cannot preserve assistant liveness.
- Salvage:
  - stable canonical query-source hashing;
  - query-source dirty detection from canonical write receipts;
  - source-hash before/after race guard;
  - empty/current replica publishing;
  - capped writes and publish-conflict/backoff tests;
  - old side-path removed tests.
- Do not salvage by default:
  - warm-container background manager;
  - separate background child process;
  - browser-vault-only proxy token;
  - local dirty marker if it becomes scheduler state rather than compact
    source-freshness metadata;
  - removal of web refresh scheduling without a replacement trigger.
- Browser-vault freshness must not be derived from replica existence.
- Assistant reply/incoming-message liveness is the stronger invariant.
- Prefer deriving refresh need from stable source hash plus latest published ref.
  Add a persisted dirty marker only if implementation evidence shows the derived
  check is too expensive or ambiguous.
- Keep the existing web-to-Cloudflare refresh route during migration, but make it
  request real low-priority runtime work instead of a generic no-op nudge. Remove
  or narrow the route only after both web and Cloudflare tolerate the replacement
  path.

## Open questions

1. Should the low-priority runtime demand be represented as an explicit
   `browser_vault_refresh` invocation reason, or as an ordinary runtime wake that
   runs browser-vault maintenance after proving no higher-priority work is due?
   The explicit reason is clearer; the ordinary wake is smaller.
2. What fallback freshness SLA should web use before stable source hashes are
   available everywhere? Recommended default: stale when
   `checkpointedAt > generatedAt`, plus a 24-hour max age.
3. During deploy skew, should the current refresh route remain as the compatibility
   entrypoint until the new demand path is deployed on both sides, or can web move
   directly to the new typed call in one coordinated deploy?

## Verification

- Commands to run:
  - `pnpm --dir packages/query test:coverage` or truthful `pnpm test:diff` for
    query-source hash changes.
  - `pnpm --dir packages/assistant-runtime test:coverage` or truthful
    `pnpm test:diff` for dirty detection and refresh helper changes.
  - `pnpm --dir packages/hosted-execution test:coverage` or truthful
    `pnpm test:diff` for freshness helper/control contract changes.
  - `pnpm --dir apps/web verify` or truthful `pnpm test:diff` for session route
    behavior.
  - `pnpm --dir apps/cloudflare verify` or truthful `pnpm test:diff` for runner
    scheduling, authority, and removed-side-path behavior.
  - `pnpm verify:acceptance` when the final implementation crosses the web,
    Cloudflare, assistant-runtime, hosted-execution, and query seams together.
- Expected outcomes:
  - Focused stale-ref test reproduces the current bug before the fix and passes
    after.
  - Refresh helper publishes a valid empty replica after deletion.
  - Refresh abort/yield tests prove foreground assistant work wins, including a
    runtime wake that arrives while refresh is building or publishing.
  - No test requires raw vault contents, message bodies, prompts, local paths,
    secrets, or identifiers in logs.
Completed: 2026-05-18
