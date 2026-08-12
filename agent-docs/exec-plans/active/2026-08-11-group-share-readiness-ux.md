# Group share readiness UX

Status: active
Created: 2026-08-11
Updated: 2026-08-12

## Goal

- Start the existing private-runtime projection path immediately after a member
  approves group sharing.
- Distinguish a granted share whose projection is still preparing from a
  completed projection with no current records.
- Give the group truthful, concise feedback without exposing private data or
  weakening consent and scope boundaries.

## Success criteria

- Affirmative acceptance atomically admits the exact grant generation and its
  durable projection-maintenance mailbox row, then signals that row as soon as
  the transaction commits.
- Group shared reads expose `pending`, `missing`, and `available` as distinct
  data states while preserving `not_granted` authority semantics.
- Assistant guidance treats pending data as preparation, never as proof that
  the member has no private data, and names the recent-data window in the
  reaction consent message.
- Focused reaction, group-store/tool, parser, and runtime tests prove the
  end-to-end contract, and relevant package typechecks pass.
- Preliminary specialist and final ReviewGPT gates, exact-head CI, and parent
  review complete with no unresolved accepted findings.

## Scope

- Existing hosted group reaction/grant, runtime-maintenance mailbox, and
  scheduled handoff-recovery paths.
- Existing Web-owned vault-share snapshot/read contract.
- Existing hosted-execution parser/types and assistant group-shared guidance.
- Focused tests and matching durable consent/group-sharing documentation.

## Constraints

- Keep Web authoritative for grants and the member runtime authoritative for
  private-vault projection.
- Reuse the existing runtime-maintenance mailbox and scheduled handoff sweep;
  add no queue, scheduler, or broad state owner.
- Pending must disclose no health values, provider identity, or private-data
  existence.
- Preserve active user-critical group replies and consent revocation behavior.
- Keep confidential support evidence and direct identifiers out of repository
  artifacts, prompts, tests, docs, and review packages.

## Tasks

1. [x] Collect ReviewGPT UX recommendations and inspect the exact current
   consent, wake, projection, read, prompt, and test owners.
2. [x] Implement the smallest pending/readiness contract and immediate existing
   wake behavior with focused regression coverage.
3. [x] Run focused verification, inspect the complete diff, and update durable
   contract documentation where needed.
4. [x] Commit, push, and open the PR; run preliminary specialist and final
   ReviewGPT concurrently with exact-head CI.
5. [ ] Resolve accepted findings, complete parent review, close this plan with
   `scripts/finish-task`, and prove current-base mergeability.

## Verification log

- ReviewGPT independently confirmed that the original read boundary collapsed
  an unmaterialized null snapshot and a completed encrypted empty snapshot into
  the same missing state. Its accepted UX additions keep pending participants
  unranked, prevent repeat-consent pressure, and make selector-based seven-day
  activity disclosures explicit. Its initial maintenance-mailbox suggestion was
  deferred until exact code-path review proved that the prior payload-free wake
  had no durable recovery record.
- Focused Web verification passed: 4 files and 225 tests. Focused hosted wire
  parser verification passed: 1 file and 66 tests. Focused Assistant Engine
  verification passed: 2 files and 104 tests.
- Hosted Execution, Assistant Engine, Web, and Cloudflare typechecks passed
  after the final ReviewGPT wording refinement; the affected Assistant Engine
  tests also passed after that refinement. Durable-doc drift and direct
  pending-parser scenario proof passed.
- Complete first-provider request capture used the pinned real Codex App Server,
  the repository's scripted Responses endpoint, `gpt-5.6-terra`, low reasoning,
  production code mode, identical synthetic direct/group requests, and
  `gpt-tokenizer` 3.4.0 `o200k_harmony`. It serialized `include`, `input`,
  `parallel_tool_calls`, `text`, and `tool_choice` after normalizing temporary
  paths and UUIDs, and excluded model selection, reasoning, storage, streaming,
  cache, client, account, and transport metadata identically. Direct changed
  from 23,841 tokens / 108,952 bytes to 23,837 / 108,961 (-4 tokens,
  -0.0168%; +9 bytes, +0.0083%). Group changed from 20,277 tokens / 93,171
  bytes to 20,348 / 93,549 (+71 tokens, +0.3502%; +378 bytes, +0.4057%). The
  entire delta is the assembled instruction input; tool/schema/generated
  guidance and other included fields are unchanged. Temporary capture code and
  payloads were removed.
- Public changelog fragment validation passed: 1 file and 7 tests. The first
  concurrent invocation raced its generated registry preparation; the same test
  passed after the Web typecheck completed generation. Final Web typecheck
  passed with the fragment included.
- The first preliminary ReviewGPT pass returned `INVALID` because the
  selector-based seven-day consent wording is a user-facing Web change and the
  packet had no rendered evidence. The design catalog now renders both changed
  selector shapes with the real permission-card component. Redacted desktop
  (1440 CSS px at 2x) and mobile (390 CSS px at 3x) crops passed native local
  and hosted-image inspection and are attached to the PR packet.
- The required Claude Code UI double-check was attempted after the rendered
  surface stabilized, but Fable reported explicit usage-credit exhaustion. Per
  the completion workflow, no alternate Claude request or local substitute was
  run; the gap is recorded as non-blocking.
- The branch was rebased once onto current `origin/main`. The sole textual
  conflict was the durable-doc index; the resolution preserves both main's
  hosted Telegram/projection-fairness entries and this change's immediate wake,
  pending read, and consumer-first rollout entries.
- Exact-head Assistant Engine CI exposed a one-character resident prompt-budget
  regression (`57,470` versus the `57,469` ratchet); all 3,568 other tests in
  that job passed. The pending guidance was tightened without changing its
  rules, and the four collapsed model statuses are now named directly. The
  exact failed 73-test file, the 104 focused prompt/tool tests, and the package
  typecheck pass locally after the correction.
- The corrected preliminary-specialist ZIP was inspected directly before its
  retry and contains the PR body, full diff, changed-files and phase manifests,
  plus both redacted rendered-evidence images. Two attempts to resume the prior
  invalid thread failed before send because the attachment target could not be
  matched, so the corrected packet was sent once in a fresh managed thread.
- The preliminary specialist pass and final ReviewGPT round 1 independently
  found the same two defects: seven-day consent copy did not match the
  eight-record producer, and a one-shot payload-free wake could leave pending
  without a recovery owner. Both findings were accepted. The producer now caps
  recent sleep and daily projections at seven records, native selector consent
  names the same window, approval appends the existing durable maintenance
  control row, and the scheduled mailbox handoff sweep includes unconsumed
  maintenance rows.
- Remediation proof passed: 235 focused Web tests, 101 projection-owner tests,
  an additional 88-test durable-signal/recovery subset, the 154-test group-tool
  file after native selector coverage, and Web plus Assistant Runtime
  typechecks. New boundary cases prove eight eligible sleep-timing,
  sleep-duration, selector-distance, and selector-session-count dates produce
  no more than the seven dates disclosed by consent.
- Final ReviewGPT round 2 accepted the first remediation's intent but found two
  remaining boundary failures. First, a UTC-midnight cutoff could admit an
  eighth sparse member-local date east of UTC or omit a valid date west of UTC.
  Projection reads now derive the inclusive seven-date civil window from the
  validated vault timezone, fail closed without that domain, and preserve the
  separate `workouts.v0` global close rule. UTC+14, UTC-12, Chicago, sparse, and
  daylight-saving cases cover that contract.
- Second, the grant could still commit before the maintenance append. A grant
  generation whose snapshot is null and its generation-stable maintenance row
  now commit in the same transaction. An append failure rejects the acceptance;
  retrying the same generation reuses the event identity, a regrant changes it,
  and the post-commit path signals the exact checkpoint without another
  workspace ensure or mailbox append.
- Round-2 remediation proof passed: 107 Assistant Runtime projection tests, 169
  focused Web grant/admission/signal/recovery tests, and both package
  typechecks. The final ReviewGPT rerun remains required on the remediated head.
- `origin/main` advanced after the one permitted base update. Current-base
  merge-tree proof now conflicts in the durable-doc index. Repository policy
  forbids a second update; this is a `moving-base race`, so the PR and worktree
  must remain active for handoff rather than being merged or retired here.
- Final ReviewGPT round 3 identified two remaining lifecycle defects. An
  explicit reaffirmation could reuse a materialized recent-date generation,
  and the group-share maintenance row could be removed before the later
  best-effort projection offer succeeded. The remediation rotates and clears
  explicitly reaffirmed recent-date grants in the acceptance transaction,
  retains the group-share maintenance row through a post-checkpoint projection
  record, and retries missing-port or projection failures on the existing
  system-mailbox recording path while holding back its handled watermark.
- A bounded, count-only rollout command covers already-materialized group
  health shares. Under one stable post-consumer-deploy cutoff, each grantor
  transaction rotates eligible legacy generations to pending and appends one
  durable maintenance row; failed exact signaling remains recoverable from
  that row. Current-state, email, device-status, non-group, pending, and
  post-cutoff grants are excluded, and rerunning the same cutoff is idempotent.
- Round-3 remediation proof currently passes 88 focused Web tests, 95 focused
  Assistant Runtime tests, and Web plus Assistant Runtime typechecks. The
  required final ReviewGPT remediation round and exact-head CI remain pending.
- Final ReviewGPT round 4 accepted two review-induced gaps. A retained share
  projection retry shared the generic runtime-control serialization key, so it
  could starve later independent controls such as account disconnect. The
  runtime now derives a projection-only serialization key from the existing
  generation-stable wake and recomputes the earliest mailbox wake after a
  failed record, preserving projection FIFO while letting independent controls
  proceed.
- The prior rollout also cleared legacy snapshots before the pending-aware Web
  reader was deployed. The rollout is now explicit expand/backfill/contract:
  deploy and converge the runtime consumer, deploy the complete pending-aware
  Web reader/writer, then capture the cutoff, run the backfill, and drain its
  durable work. This executable sequence needs no partial release or feature
  flag and guarantees the truthful reader is live before any old snapshot is
  cleared. Production count-only proof confirmed that orphaned pending
  projectable rows are not merely theoretical, so the bounded backfill includes
  that class. Rotating its ID and appending fresh work is idempotent under the
  stable cutoff; non-projectable live-derived pending rows remain excluded by
  projection kind.
- The delivery path now carries a fixed-width opaque digest of the exact active
  scope generation resolved before the vault read. Web recomputes the digest
  against the active destination set immediately before replacement. A consent
  rotation during the read therefore produces the ordinary no-active result and
  a fresh retry instead of writing old records into the new generation. Raw
  share IDs and recipient cardinality remain outside the private runtime.
- Final ReviewGPT round 5 found that tokenless legacy delivery still bypassed
  that fence during mixed-version operation. The contract now requires the
  digest on every delivery; new Runtime fails before reading a projectable
  scope when old Web omits proof, and new Web returns a retryable error before
  lookup or replacement when an old Runtime omits proof. The token-capable
  runner fleet is the hard rollback floor before Web promotion, and the
  pending-aware Web reader becomes its own rollback floor as soon as the Web
  writer begins admitting fresh null-snapshot generations.
- Final ReviewGPT round 6 found that generation discovery and delivery still
  used an owner-only access approximation. A non-suspended room with an
  inactive owner but a current active participant could therefore remain live
  while its approved share stayed pending forever. Both candidate reads now
  use one participant-aware set resolver with the canonical owner-or-current-
  participant semantics. Exact-scope reads are capped by the existing 25-
  destination admission invariant; all-scope reads compose that limit with the
  finite known projection registry, participant rows compose the candidate set
  with the 32-person roster limit, and every overflow fails closed. Focused
  proof covers mixed owner-backed and participant-backed generation hashing,
  participant-only discovery, inactive exclusion, both-recipient replacement,
  access-change token rejection, and set-based query counts.
- Round-6 remediation proof passes 137 focused Web tests, 9 Hosted Execution
  contract tests, and Web plus Hosted Execution typechecks. The required final
  ReviewGPT remediation round remains pending.
- Final ReviewGPT round 7 found that temporarily inactive destinations could
  consume the only durable projection obligation: active-scope discovery
  omitted them, `no-active-share` was terminal after checkpoint, and renewed
  participant access later exposed a permanently null pending snapshot. The
  remediation keeps access filtering authoritative while Web returns only one
  opaque deferred-work bit. Active destinations still materialize immediately;
  any omitted null-snapshot generation retains the existing mailbox item on a
  five-minute deferred retry. Exact generation mismatches and mid-fan-out access
  changes are retryable while approved null work remains. Older runners declare
  no deferred-work capability and receive a retryable discovery failure during
  convergence, preventing mixed-version row consumption without a new state
  owner.
- Round-7 remediation proof passes 441 focused tests across Hosted Execution,
  Assistant Runtime, Web, and Cloudflare, plus all four package typechecks. The
  seven-round cap is reached; repository policy requires an explicit
  continuation decision before a round-8 ReviewGPT audit. Exact-head CI and
  current-base mergeability also remain unresolved.
- The user explicitly authorized ReviewGPT round 8. That full-patch audit found
  that a targetless maintenance retry still discovered and rewrote every active
  materialized destination, so one durable effect could perform 98 private reads,
  98 delivery requests, and 2,450 sequential replacement transactions before
  foreground work regained control at the admitted registry and destination
  bounds. The finding was accepted.
- The remediation adds no durable owner or cursor. The existing null snapshot is
  the progress cursor: maintenance requests an acknowledged
  `first-materialization` mode, Web excludes materialized rows at the source
  query, and one
  deterministic page contains complete exact-scope generations totaling at most
  25 null destinations. Delivery reselects and conditionally replaces only exact
  null rows. A page with progress and more work continues after one second; only
  inaccessible or unsupported null work uses the existing five-minute retry.
  Generic abortable idle refresh remains unchanged.
- Round-8 remediation proof passes 451 focused tests across Hosted Execution,
  Assistant Runtime, Web, and Cloudflare, plus all four package typechecks. It
  covers maximum materialized fan-out exclusion, inactive-destination
  reactivation, complete-scope page bounds, redundant-maintenance exclusion,
  mode acknowledgment, prompt continuation versus deferred retry, and foreground
  admission between pages. Final ReviewGPT must rerun on the remediated exact
  head; exact-head CI and current-base mergeability remain unresolved.
- Corrected-head product-purpose revalidation: the irreducible purpose remains
  truthful, recoverable preparation immediately after exact consent. The bounded
  page is the smallest complete experience because it changes no user action,
  screen, consent, or visible copy; it prevents background maintenance from
  monopolizing the runtime, admits foreground work between pages, promptly
  continues after progress, and preserves the existing delayed retry only when
  remaining work cannot currently run. `pending` stays the honest visible state
  and the next authorized group read remains the existing completion surface.
  No evidence-backed product-experience finding or new rendered-evidence gap
  remains; exact-head CI and the final cross-cutting audit are still pending.
- Final ReviewGPT round 9 accepted one remaining symmetric terminality defect.
  Temporary grantor inactivity after source checkpoint returned an acknowledged
  first-materialization response with no deferred work, so Runtime consumed the
  sole mailbox item while current grants could remain null. Restored family
  sponsorship does not necessarily emit a new activation or runtime-recheck wake
  for an already-activated non-owner, making the pending state permanently
  dependent on unrelated activity.
- The remediation changes only the inactive-grantor response for acknowledged
  first materialization: deferred-capable runtimes receive the existing opaque
  deferred bit with no scopes or grant/destination read, while old runtimes
  receive the existing generic retryable capability error. The same local item,
  blocked watermark, five-minute retry, and scheduled handoff remain the owners.
  Generic idle refresh stays terminal. After access returns, the retry either
  materializes remaining null grants or terminates normally if they were revoked.
- Round-9 remediation proof passes 455 focused tests across Hosted Execution,
  Assistant Runtime, Web, and Cloudflare, plus all four package typechecks. Direct
  cases prove inactive first materialization reads neither share discovery nor
  private vault state, retains the item and watermark on the five-minute retry,
  permits independent controls, retries without grantor input, terminates after
  restored authoritative access sees revocation, fails closed for an older
  runtime, and preserves generic idle-refresh terminality. Final ReviewGPT must
  rerun on the corrected exact head; exact-head CI and current-base mergeability
  remain unresolved.
- Round-9 corrected-head product-purpose revalidation: the irreducible purpose
  is still truthful, recoverable preparation after exact consent. Treating
  temporary grantor inaccessibility as opaque deferred work is the smallest
  complete experience because it adds no user action, promise, visible state,
  notification, or recovery concept; it preserves `pending`, prevents accepted
  work from becoming ownerless, and resumes through the already-scheduled local
  retry. Generic idle refresh remains terminal, and revocation still ends the
  item after authoritative access returns. No evidence-backed product-experience
  finding or new rendered-evidence gap remains on the corrected behavior.
