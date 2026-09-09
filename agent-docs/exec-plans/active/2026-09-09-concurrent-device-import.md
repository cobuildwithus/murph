# Import device data during foreground conversation

Status: active
Created: 2026-09-09
Updated: 2026-09-09

## Outcome and protected invariants

Accepted device data becomes queryable during a live assistant turn. Conversation admission and reply delivery never await provider fetch or historical import completion. Keep one restored workspace, write fence, canonical persistence history, and checkpoint owner. Preserve consent, disconnect, exact payload acknowledgment, retries, and crash recovery.

## Evidence and current owners

The runtime classifies device work as idle-only, excludes system requests behind an active default owner, and yields device execution to foreground activity. A held-model regression will establish the composed gap without private production evidence. Core already serializes canonical commits; query projection publication is transactional but its multi-file source read needs a coherent commit boundary before concurrent imports are enabled.

## Scope and simplification

Reuse the current runtime wake, device service, dirty state, core importer, and hosted receipt/checkpoint paths. Admit one bounded import operation alongside foreground execution. No new service, database, durable queue, configuration switch, or independent workspace. Preserve existing commit/rollback protection until a focused test proves a narrower boundary is safe. The date-range feature and onboarding policy are outside this change.

## Product UX

Outcome: new and established members can query arriving device data while chatting.
Entry and promise: a connected device supplies authorized data; the conversation remains responsive while usable observations appear.
Journeys: arriving payload during a held model turn; slow provider with fresh conversation; concurrent health query/write; interrupted import and recovery; disconnect/consent or lease loss.
Proof: composed runtime tests through canonical readback, foreground delivery, and durable acknowledgment; focused real assistant verification if model/context behavior changes.
Done when: every selected journey passes without lost writes, stale-success claims, premature acknowledgments, or new unsolicited messages.

## Tasks

1. Trace existing owner seams and add a failing composed concurrent-ingestion regression.
2. Implement the smallest same-owner scheduling change plus necessary query/persistence coordination.
3. Prove foreground independence, shared-write safety, coherent reads, cancellation/drain, and durable retry behavior.
4. Update owner contracts and a scoped public changelog entry.
5. Run affected typechecks/tests, review complexity and privacy, commit, push a draft PR, then start exact-head CI and final ReviewGPT together.
6. Resolve findings, close the plan, and report the PR with exact proof and limitations.

## Verification

Use existing assistant-runtime workspace/entrypoint suites, Cloudflare runtime admission tests, core concurrency/rollback tests, and query projection tests. Hold model/provider promises rather than relying only on timing sleeps. Measure mixed-load foreground latency with synthetic fixtures and report the tested boundary, not a production guarantee. Run affected typechecks after the final TypeScript edit. No production mutation is part of validation.

## Progress

- Isolated task branch created.
- Prior architecture review inspected; its recommendations are claims to test, not authority to add machinery.

## Query consistency proof

- Reproduced a separate canonical writer paused after applying files but before
  hosted persistence. Before the fix, both commit and rollback journeys published
  the uncommitted query snapshot. The new regression failed in both cases.
- Rebuild now captures the manifest, reads canonical source, and publishes SQLite
  under the existing cross-process canonical write boundary. Fresh projection
  reads retain their existing path; no additional state or lock is introduced.
- Both regression cases now pass. Query package: 803 tests across 71 files pass;
  package typecheck passes.
- Local alternating base/head rebuild sample, five runs each, one synthetic
  provider import containing 20,000 readings (71 projected entities): base
  114/74/73/57/53 ms; head 77/74/70/62/58 ms. Median 73 versus 70 ms.
  This measures rebuild overhead on a compact projection, not production p95 or
  foreground contention. The global commit boundary still serializes conflicting
  work; foreground runtime event-order proof remains required.

## Foreground starvation reproduction

- Added a composed runtime regression using the real workspace runner,
  mailbox staging, hosted assistant phase, and device importer. Only the model
  and external provider/control ports are synthetic.
- Baseline fails after the model starts and the late device mailbox item is
  staged: no provider work starts while the model remains open. The acceptance
  assertion requires a real canonical query to see the imported record before
  that model turn finishes.
- Replaced the live wearable-arrival journey's canned CLI response with the
  real provider importer and CLI. Its deterministic fixture proof passes.
  The documented bounded authenticated-profile fallback subsequently passed.

## Live readback result

- Focused real-Codex journey passed with `gpt-5.6-terra`, local subscription,
  after the documented fallback reached an available authenticated profile.
- First read truthfully reported missing workout data. After a real canonical
  provider import, the same conversation reread the CLI and correctly reported
  distance, duration, and the original request's local/UTC times.
- Parent reply review: Ready for truthful missing-data and later-import readback.
  This supplements, rather than substitutes for, the held-model runtime test.

## Admission proof

- Controller regression failed on the baseline with `retry_later` for system
  work behind an active default owner.
- Allow that existing foreground owner to receive a normal wake. Preserve its
  exact fence, generation, and default mode; do not send a system mode handoff.
  Older warm consumers therefore retain their existing ownership and queued
  recovery behavior.
- The regression and 12 adjacent foreground preemption/coalescing/wake tests
  pass. Cloudflare package typecheck passes.

## Concurrent runtime proof and review

- The composed entrypoint test now reaches real reply dispatch with a synthetic
  transport. No-import, completed-import, and stalled-provider cases pass.
  Completed observations are queried before the held model finishes; a stalled
  provider is canceled and the reply dispatch completes within the test's
  two-second post-model bound. This is a dependency/order proof, not a measured
  production latency percentile.
- Five runner journeys pass: shared receipt history across foreground/import
  writes, exact snapshot restoration before dirty acknowledgment, preserving a
  newer dirty revision, bounded conversation admission, cancellation of stalled
  requests and bodies, and rollback after authority rejects a canonical receipt.
- Candidate ReviewGPT returned a scoped implementation. Local validation corrected
  incomplete synthetic bootstrap/connection-epoch fixtures and canonical metric
  naming; production authority checks remain intact. Its separate final exact-head
  PR review is still pending.
- Reused one cancellation signal for mailbox staging and one invocation shutdown
  signal for existing background work. Collapsed repeated yielded-result builders
  and repeated initial-foreground state. The complexity guard passes, reducing
  existing device-pass and event-handler debt without increasing runner debt.
- A pre-existing projection test raced terminal failure against delivery stop.
  Its unchanged zero-watermark assertion now follows an explicit cancellation
  boundary before projection release. The complete runner file passes 146 tests.
- Focused supporting checks: 200 core tests; 803 query tests; 177 controller tests;
  real assistant readback; affected package typechecks. Adjacent runtime checks
  pass apart from the subsequently corrected projection-test race; final focused
  rerun and exact-head CI remain required.

## Limits and rollout

- At most one completed preparation per durable checkpoint; subsequent batches
  retain existing checkpoint scheduling. Provider fetch/body cancellation is
  cooperative, and an in-flight canonical commit may delay quiescence until its
  existing bounded persistence or rollback completes.
- No wire/schema change. Either deployment order is compatible; acceleration
  requires the updated worker and runtime. Old warm consumers keep default
  ownership and durable queued recovery. Deployment and rollback are separate
  authorized operations, not part of this task.

## Exact-head CI fixture follow-up

- The first CI runtime coverage pass exposed lane-agnostic fetch assertions and
  a scheduling fixture that depended on uncancelled system staging after its
  model phase returned. All 90 tests in those three files pass on the baseline.
- Reused the existing conversation-cursor helper, bounded added system fetches,
  and held the retry scenario until its required staging event. Original cursor,
  retry-before-checkpoint, and quiet-window assertions remain intact.
- All 90 tests now pass on the candidate; assistant-runtime typecheck passes.
  This follow-up changes only tests and this plan. The 213-test final runner,
  composed delivery, and phase run also passed before the first push.

## Foreground follow-up correction

- Final review found that pending device-checkpoint state was incorrectly ORed
  into completion-only foreground routing. Accepted on source-path evidence;
  the user resumed and authorized the correction.
- Extended the existing composed entrypoint journey with a second member input
  and reply while snapshot completion is held. The regression failed before
  correction: the first reply completed but the second model turn never began.
- Removed the extra routing condition. Existing duplicate-preparation and
  background-maintenance guards remain the only checkpoint-dependent gates.
  Both replies now precede snapshot completion; only one import receipt exists,
  and the exact dirty revision/payload is acknowledged once afterward.
- All 303 tests across the composed, runner, device-phase, conversation-import,
  restore, and scheduling suites pass. Runtime typecheck and complexity guard
  pass. The existing live assistant readback evidence remains applicable because
  its engine/importer/CLI path and production provider input are unchanged.
- Round-two final review and CI will run against the corrected pushed head.
