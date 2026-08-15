# Replace cross-session receipt scans with a bounded index

Status: active
Created: 2026-08-13
Updated: 2026-08-14

## Goal

- Preserve unanchored replies to proactive messages from another assistant
  session while replacing the growing receipt-inventory scan on the foreground
  provider-start path with bounded route state.

## Success criteria

- An unanchored inbound message may still receive the newest eligible
  cross-session outbox delivery as context.
- Once delivery B is consumed by a completed or deferred turn, B and every
  older delivery on the same exact route cannot resurface.
- Failed and blocked turns do not consume B; an unresolved running turn fails
  closed for optional unanchored context.
- Exact provider-message reply anchors remain authoritative and may target a
  delivery below the unanchored watermark.
- Steady-state selection reads one route record and at most one referenced turn
  receipt; it never enumerates the receipt directory.
- Focused crash, ordering, migration, restore, corruption, and retention tests,
  package typecheck, exact-head CI, and both required ReviewGPT gates pass.

## Scope

- In scope: assistant-engine route-state ownership, pre-provider claim ordering,
  legacy receipt migration, runtime-residue retention/compaction, focused tests,
  and the durable hosted runtime/file-count contracts.
- Out of scope: general turn receipts, handled-reply/idempotency recovery,
  provider-message-id outbox attestation, databases, services, queues, or a new
  background process.

## Constraints

- Technical constraints: file-native portable operational state; one atomic
  record per exact route; receipt terminal evidence remains the commit witness;
  no post-terminal correctness write; preserve `(sentAt, intentId)` ordering;
  corrupt or ambiguous optional state fails closed.
- Product/process constraints: smallest maintainable architecture, bounded
  mixed-version compatibility, immediate hosted rollout if the route-primary
  reader creates a rollback floor, focused local proof before PR review, and
  exact pushed-head CI plus ReviewGPT completion.

## Risks and mitigations

1. Risk: A cursor written after terminal receipt finalization can lag after a
   crash and replay consumed context.
   Mitigation: install the claim after the running receipt exists and before
   provider egress; derive commit only from that referenced receipt.
2. Risk: Replacing a failed pending claim loses the previous committed
   watermark.
   Mitigation: keep `settledThrough` and one pending claim in the same bounded
   route record.
3. Risk: Existing wildcard route matching does not define a stable partition.
   Mitigation: centralize exact route resolution and fail closed for ambiguous
   unanchored routes while retaining exact provider-id replies.
4. Risk: Legacy workspaces or old writers have receipt-only consumption.
   Mitigation: let the existing residue owner perform one idempotent migration
   from its already-trusted inventories, fail optional foreground context
   closed until the marker exists, and keep legacy receipt metadata through the
   documented rollback horizon.

## Tasks

1. Have ReviewGPT choose and pressure-test the minimal constant-work state
   shape against current owners and failure boundaries.
2. Have a separate ReviewGPT produce an implementation patch from that design;
   inspect every hunk and integrate only repository-consistent changes.
3. Add route-state read/claim/compaction and bounded legacy migration at the
   existing assistant runtime owner boundary.
4. Replace the cross-session receipt enumeration while keeping unrelated
   receipt callers intact.
5. Add direct proof for terminal outcomes, crash boundaries, exact anchors,
   order ties, route isolation, migration, corruption, restore, and retention.
6. Run focused tests and package typecheck, inspect the full diff, commit, push,
   and open the draft PR.
7. Start preliminary specialist and final ReviewGPT round 1 concurrently with
   exact-head CI; resolve accepted findings and repeat final rounds until pass.
8. Close this plan with the final scoped task commit and prove current-base
   merge-tree readiness.

## Decisions

- ReviewGPT selected one route-owned `settledThrough` watermark plus at most one
  pending `{delivery, consumerTurnId}` claim. The claim is installed at the
  existing pre-provider boundary after receipt creation; the referenced
  receipt's matching completed/deferred timeline evidence commits it. A
  same-turn upgrade retains one receipt-proven prior order so an abandoned
  newer steer cannot consume the wrong message or replay an earlier accepted
  one. A terminal receipt without any matching evidence clears an abandoned
  claim without consuming it. No required route mutation
  follows terminal receipt persistence.
- Outbox remains the owner of delivery content and attestation. General turn
  receipts remain the owner of turn outcome. The route record owns only the
  specialized cross-session consumption watermark.
- A naked latest-receipt pointer, post-terminal cursor/outbox mutation,
  recent-N cap, session-owned cursor, and steady-state rebuilt projection were
  rejected because they lose prior progress, recreate a crash gap, discard
  correctness, disappear on rollover, or retain O(n) work/lifecycle machinery.
- First-use foreground migration was rejected because it would preserve the
  exact O(n) latency spike this task removes. Exact provider-message anchors
  remain available before migration and write the same bounded pending claim
  before live provider steering; optional unanchored context fails closed until
  the residue-owned marker is complete.
- Preliminary ReviewGPT found that ambiguous legacy running consumers could
  throw before residue cleanup and that a route claim could protect an
  abandoned running receipt forever. Final ReviewGPT round 1 also found that
  local, assistantd, and one-shot runs had no guaranteed migration owner. The
  correction reuses the automation post-pass boundary for every runtime mode:
  the first trusted pass folds legacy running consumers into one per-route
  suppression watermark and publishes the migration marker, while later
  passes exact-read only pending witnesses. At quiescence an unresolved claim
  becomes a suppression watermark and clears immediately; it does not assert
  successful provider consumption, and exact anchors still bypass it. Routes
  without live outbox authority are deleted before reconciliation. This
  removes the timeout, abandoned-turn classifier, and route-specific receipt
  protection instead of adding another lifecycle.
- Final ReviewGPT round 2 found that the first shared owner still ran before
  local queue delivery and before hosted foreground delivery. The correction
  moves local, assistantd, and one-shot maintenance after the current pass's
  direct delivery or queue drain, and composes hosted maintenance after
  checkpoint delivery (or after an already-completed synchronous delivery).
  Multi-file inventory and migration loops now check the existing foreground
  yield signal between entries; a yielded partial migration is idempotent and
  cannot publish its marker. This keeps migration ownership in every runtime
  mode without putting the legacy O(n) walk on either provider-start or
  member-delivery latency.
- The follow-up invariant pass found that a fresh local or hosted input could
  not flip the yield signal until after staging acquired the same runtime lock,
  and that hosted background/no-progress passes did not own migration. Fresh
  input now signals before staging and re-arms after durable persistence;
  background, fast-delivery, and no-progress hosted results all reconcile after
  their delivery boundary. Maintenance reports actual mutations so a
  maintenance-only or partial migration is checkpointed, and process/lease
  aborts stop the per-entry traversal. Migration-only progress remains distinct
  from assistant progress and cannot trigger managed automation work.
- Final ReviewGPT round 3 found that the hosted pre-staging yield reused the
  durable-stage observation, so loop shutdown could abort a freshly awakened
  import before it wrote the input event or pending index. The correction keeps
  one ephemeral in-flight import count solely for cooperative maintenance
  yielding, reserves the existing work-observed flag for durable staging, and
  leaves the maintenance abort signal owned only by process or lease
  cancellation. A yielded partial migration can therefore return its actual
  mutation result for checkpointing while an unstaged import must finish before
  loop shutdown.
- Final ReviewGPT round 4 found that the invocation-wide staged-work flag still
  let an earlier durable item authorize aborting a later item before its own
  stage. The correction keeps that invocation-wide fact only for wake
  reconciliation and adds one loop-local current-item staging fact for stop-time
  abort authority. Each serial item resets the local fact before import, sets it
  at its existing durable callback, and clears it on completion, so prior work
  cannot cancel a following unstaged message.
- Final ReviewGPT round 5 found that route migration and cleanup used sent-only
  outbox authority even though the existing exact Linq reply path accepts one
  unambiguous provider-accepted media message while its sibling rich-link
  delivery is still retryable. The correction reuses that existing evidence
  mode at only the two route-authority boundaries, preserving its consumption
  watermark through retry and later sent transition without widening the
  unanchored foreground selector.
- Final ReviewGPT round 6 found that the real successful Linq rich-link retry
  replaced the accepted media delivery's nested timestamp, making the same
  intent compare newer than its settled watermark. The correction reuses the
  accepted media checkpoint as the stable per-intent route order through
  repeated partial failures and final success. It preserves the first accepted
  timestamp only inside the nested delivery while the intent's top-level
  `sentAt` and `updatedAt` record actual completion; no new state, selector
  exception, or migration version is introduced.
- Final ReviewGPT round 7 found that crash recovery could discard that distinct
  top-level completion checkpoint, rewrite the intent as a new attempt, and
  terminalize receipts, diagnostics, and cron state at the earlier nested media
  acceptance time. The correction recognizes a concrete persisted delivery
  before mutating dispatch state, passes its existing top-level checkpoint to
  every recovery terminalization, and retains that checkpoint if the optional
  post-persistence hook fails. No provider replay or new persisted field is
  introduced.
- Final ReviewGPT round 8 found that route cleanup, marker-missing migration,
  and exact-reply lookup still rejected that durable message-delivery
  checkpoint during its stale-recovery grace window. The correction promotes
  the existing completion-checkpoint predicate into the shared delivery
  evidence owner and reuses it only in the already-authorized non-sent evidence
  mode. Sent-only unanchored selection remains unchanged, and message reactions
  retain their separate exact-consume confirmation path. No new state, repair
  loop, migration version, scheduler, or selector exception is introduced. A
  proposed legacy media fallback was rejected because production delivery
  already records explicit media-effect metadata; the existing recovery test
  fixture now represents that contract directly instead.
- Final ReviewGPT round 9 found that the non-group Linq/iMessage exact-reply
  resolver still built its candidate list with sent-only evidence, so a native
  reply or reaction could lose its exact assistant context during the durable
  completion checkpoint's stale-recovery grace window. The correction enables
  the existing non-sent evidence mode only when a provider reply anchor is
  present and replaces both ad hoc provider-id searches with the existing
  fail-closed exact-delivery resolver. Unanchored selection remains sent-only;
  no state, owner, migration, repair, or lifecycle mechanism is added.

## Verification

- Commands to run: focused assistant-engine Vitest files, assistant-engine
  package typecheck, relevant runtime-state/restore proof if touched, and the
  exact-head required GitHub checks.
- Expected outcomes: no receipt inventory call from steady-state unanchored
  selection; one route read plus zero-or-one receipt read; all terminal,
  ordering, migration, route, corruption, and restore cases above pass.
- ReviewGPT round 3 remediation: the two hosted-runtime suites pass 402 tests;
  the four route-state and automation suites pass 244 tests; assistant-runtime
  and assistant-engine typechecks and builds pass under Node 24.14.1. The local
  pre-staging lock test now resolves the runtime-write-lock module from the same
  reset module graph as the run loop, so the full-file proof exercises the
  in-process queue instead of producing a false external-lock collision.
- ReviewGPT round 4 remediation: focused current-item tests prove that an
  earlier staged item cannot abort the next item before its stage, the current
  item's projection stall remains abortable after its stage, and a no-op import
  releases cooperative yield. The two hosted-runtime suites still pass 402
  tests, and assistant-runtime typecheck and build pass under Node 24.14.1.
- ReviewGPT round 5 remediation: two focused route-state tests cover accepted
  non-sent Linq media migration, cleanup retention, later sent transition,
  unanchored rejection, and final authority removal. The five route-state,
  runtime-residue, automation, wake, and reply-event suites pass 326 tests;
  assistant-engine typecheck and build pass under Node 24.14.1.
- ReviewGPT round 6 remediation: the production Linq dispatch path covers an
  accepted generated-image primary, two rich-link partial attempts, exact
  reply consumption, marker-missing migration, successful retry, stable
  watermark maintenance, actual unanchored rejection, and eligibility of a
  genuinely new intent. Five affected assistant-engine suites pass 249 tests;
  assistant-engine typecheck and build pass under Node 24.14.1.
- ReviewGPT tooling refresh: the registry, installed package, and repository
  wrapper all report `0.5.127`. The manifest, lock entry, and existing
  version-specific release-age exception advance from `0.5.126` without
  re-resolving unrelated transitive dependencies. Frozen install, dependency
  policy, and the full workspace typecheck pass. The required dependency audit
  still reports the workspace's existing advisory set; this metadata-only
  update changes no transitive package version. The repo-tools suite passed
  536 of 541 tests while competing with that workspace typecheck; the five
  process-readiness timeouts then passed in an isolated 48-test rerun.
- ReviewGPT round 7 remediation: the real Linq generated-image path now stops
  after durable pending-confirmation persistence and resumes after the stale
  grace window without another provider call. Focused outbox coverage also
  proves the same checkpoint survives an ordinary post-persistence hook error,
  with the original nested media time retained while terminal intent, receipt,
  diagnostic, cron success, and next-run state derive from actual completion.
  The three affected Vitest files, assistant-engine typecheck, build, and diff
  validation pass under Node 24.14.1.
- ReviewGPT round 8 remediation: the 32-test exact route-state suite covers
  checkpoint authority retention, marker-missing migration, sent-only
  exclusion, ambiguous retry exclusion, non-idempotent message checkpoints,
  and actual authority removal. Four focused outbox recovery tests cover
  post-persistence message completion, reaction confirmation, stale reaction
  recovery, and non-idempotent no-replay behavior; the 30-test dispatch-state
  suite and assistant-engine typecheck also pass.
- ReviewGPT round 9 remediation: a focused direct Linq/iMessage reaction test
  proves that a native provider anchor resolves the exact assistant message
  from a persisted message-delivery completion checkpoint instead of being
  terminally suppressed. The full 81-test reply-event suite, 32-test exact
  route-state suite, and assistant-engine typecheck pass.
