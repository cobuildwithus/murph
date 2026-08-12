# Actionable physical-note rejections

## Goal

When Lob definitely rejects a physical note, tell the member what category of
problem prevented printing and what they can safely do next, while preserving
the existing one-effect, replay, privacy, and complimentary-claim guarantees.

## Proven production symptom

- One explicit physical-note request reached the Web owner, created exactly one
  durable reservation, and entered the old terminal-failure path before any
  provider letter id existed. The old classifier included HTTP 408, so stored
  state cannot prove that the provider effect did not start.
- The failed row released its complimentary claim under that old classifier.
- The Lob adapter discarded the structured 4xx error body, the durable row kept
  no safe failure reason, and the assistant reduced the result to a generic
  non-actionable rejection.
- Lob's current official OpenAPI contract defines a structured error code and
  human-readable message. Provider text is untrusted and may contain private
  address details, so it must not cross the member-facing boundary verbatim.

## Success criteria

- Known Lob rejection codes map to a small provider-neutral reason taxonomy for
  recipient address, artwork, printing availability, or Murph request defects.
- Unknown or malformed definite rejections remain truthful without guessing.
- The safe reason is stored on the existing Web-owned physical-note row and is
  returned identically on replay; no address, provider message, artwork, or
  prompt is persisted.
- The assistant gives reason-specific next steps, states that nothing was sent,
  and never invites an automatic retry after an ambiguous outcome.
- HTTP outcomes that may be ambiguous do not release the one-effect reservation.
- A Cloudflare Web-control HTTP 408 remains pending because Web may have
  consumed the POST and accepted the note before the caller timed out; it never
  becomes definite no-send guidance.
- A current `starting` row never re-enters Lob create on same-key replay, even
  when a refreshed private-media URL changes the request body. Its exact replay
  uses one bounded metadata lookup: accepted evidence finalizes the same row,
  while recent absent or indeterminate evidence remains pending and only aged
  proven absence becomes unknown.
- A distinct request blocked while the original Lob call is in flight is
  narrowed atomically to accepted-prior or unknown when that original call
  terminalizes, so its exact replay cannot remain factually unresolved.
- Pre-migration failed rows without a reason and current `starting` rows form
  one member-wide unresolved-effect guard. A distinct request is persisted as
  unsent before an age-gated lookup can resolve the older row, and never sends
  as part of that reconciliation.
- Existing accepted, pending, permission, unavailable, and usage behavior stays
  unchanged.

## Architecture

- Extend the existing physical-note contract with one nullable failure-reason
  enum; do not add a workflow, queue, retry owner, fallback provider, or second
  state owner.
- Parse only Lob's bounded allowlisted error code. Never propagate or persist its
  freeform message.
- At the Cloudflare Web-control boundary, exclude HTTP 408 from generic 4xx
  definite-failure mapping so it reaches the assistant's existing pending path.
- Add one nullable column to `hosted_physical_note` so a definite rejection has
  the same answer on the original call and every replay. Null on an existing
  failed row is the legacy-ambiguity marker, not an unknown definite rejection.
- Treat every current `starting` row and every pre-migration failed row without
  a reason as one member-wide unresolved-effect guard. A restored accepted row
  retains its billing-neutral replay marker but is no longer unresolved and
  cannot block a later separately authorized request. Same-key `starting`
  replay stays pending and never
  calls Lob create. Before reconciling an older row for a distinct request,
  persist that current request as an unsent `prior_note_unresolved` failure
  under its own request key, so a concurrent replay cannot invite another send.
  After 23 hours, use the existing Lob lookup outside the transaction. Recent
  or indeterminate evidence keeps the blocker unresolved. Proven absence marks
  both the guarded row and blocker `unknown`; the blocked request stays unsent,
  and only a later explicit request may send. Proven acceptance finalizes a
  current `starting` row and its original paid usage when applicable, or
  restores a legacy row without reconstructing erased billing evidence, then
  narrows the blocker to `prior_note_accepted`. Always answer with the current
  row so reply loss and replay cannot turn a suppressed request into a provider
  effect. Do not add another enum, queue, state owner, or reconciliation
  lifecycle.
- Re-read the member-wide unresolved-effect guard after taking the existing
  member lock and again at final reservation admission. A row selected before
  the lock is only a hint; resolving it cannot authorize a send while another
  guard still exists. Keep provider lookup outside the transaction.
- Cover the member-scoped unresolved-effect lookup with an index on member,
  status, reason, and creation time so physical-note history does not create a
  table-scan hot path. The request performs one bounded row lookup and at most
  one serial provider lookup; it never fans out by history cardinality.
- Deploy the additive migration and current Web producer first so the HTTP 408
  ambiguity fix precedes the new recovery behavior. An old strict runner rejects
  a categorized response and fails closed to pending without retry. Then deploy
  the Cloudflare Worker and runner bundle with `container_rollout=immediate` and
  require managed-container smoke proof of the exact new runner-bundle
  fingerprint. Current Web becomes the hard rollback floor before it can write
  the new no-send authority; roll Cloudflare back first and forward-fix Web.
  A below-floor emergency disables and drains the physical-note capability
  before old Web is restored and keeps it off until compatible artifacts return.

## Implementation

1. Add failing contract and Lob-adapter tests for safe rejection mapping and
   ambiguous HTTP classification.
2. Persist and replay the safe reason in the Web physical-note owner.
3. Return reason-specific assistant recovery guidance and update the physical
   note product contract.
4. Run focused contract, Web, assistant, Prisma migration, and typecheck proof.
5. Push an exact candidate, run the required preliminary specialist and final
   ReviewGPT gates concurrently with CI, resolve accepted findings, and close
   this plan with the final scoped commit.

## Verification

- Lob adapter tests cover every public reason category, malformed/unknown
  payloads, and 408/5xx ambiguity without retaining provider text.
- Web service tests prove persistence, replay parity, complimentary release only
  for definite rejection, legacy accepted/absent/indeterminate recovery, and
  current-request identity plus zero provider calls across suppression replay.
  Restored legacy acceptance bypasses ordinary paid finalization and records no
  usage even when another note already owns the complimentary claim.
- Assistant tool tests prove each member-facing recovery path and preserve the
  pending no-retry instruction.
- Cloudflare port and Assistant integration tests prove a control-plane HTTP 408
  rejects into the existing pending result without a “nothing was sent” claim
  or another-request invitation.
- Round 11 focused proof passes 20 Web owner tests, 3 real-PostgreSQL
  concurrency tests, and 20 Assistant physical-note tests. The changed Web
  files pass focused ESLint, Web and Assistant typechecks pass, and agent-docs
  drift verification passes.
- Focused Hosted Execution, Web, Assistant Engine, and Cloudflare tests pass:
  6, 87, 15, and 5 tests respectively. Prisma validation and generation pass,
  as do all four affected package/app typechecks. The opt-in real-model journey
  compiles and selected the exact test locally, but its paid execution is
  blocked when the provider credential is absent; deterministic owner tests
  remain the authoritative local proof.
- Complete first-provider request capture compared guarded PR base
  `57c6a766de79cf250ab10588b95cd41fd0129c5f` with runtime candidate
  `d3956a35ba5c3c07227d227476e22adb397d096c` through the pinned real Codex
  App Server, local scripted provider, `gpt-5.6-terra`, low reasoning,
  production code mode, and identical direct/group physical-note requests.
  `gpt-tokenizer` 3.4.0 `o200k_harmony` counted `include`, `input`,
  `instructions`, `parallel_tool_calls`, `text`, `tool_choice`, and `tools`
  after normalizing host paths and generated message ids. Direct is
  byte-identical at 24,874 tokens / 114,460 bytes; group is byte-identical at
  22,033 / 102,057. The skill recovery text and tool-result instruction enter
  only after a failed tool call, so assembled initial instructions, tool
  schemas, and generated guidance have zero delta. Model selection, reasoning,
  storage, streaming, service-tier, cache, account, client, and transport
  metadata were excluded identically.

## Review retrospective

- Round 2 required a requirement-level retrospective because the active plan
  retained the same old-runner compatibility assumption that round 1 had
  already corrected in the product contract and PR body.
- The original and current runtime shape remain the same bounded enum, nullable
  column, allowlisted mapper, and existing-owner recovery path. Review-driven
  growth is focused tests and corrected guidance, not a new state owner, queue,
  retry path, compatibility shim, or reconciliation mechanism.
- Round 2 initially converged the rollout on immediate consumer convergence,
  exact runner fingerprint proof, Web-last deployment, and Web-first rollback.
  Round 5 supersedes that deployment decision below; adding a second protocol
  or compatibility path remains unjustified.
- Round 3 found that three new Murph-owned recovery instructions also opened the
  unrelated product-feedback path, including for transient printer failures.
  Delete that coupling, leave feedback eligibility with its existing central
  owner, and prove with both capabilities present that rejection recovery makes
  no feedback call or candidate. This contracts runtime scope and adds no
  replacement state or mechanism.
- Round 4 showed that global feedback guidance could still infer eligibility
  from the Murph-owned recovery wording. Add one narrow skill rule that a
  rejection alone is not feedback eligibility, while preserving exactly one
  candidate for independently expressed eligible repeated frustration. Cover
  both outcomes in the existing opt-in real-model journey; do not add runtime
  flags, recorder filters, or another feedback policy owner.
- Round 5 found that the rollout reasoning over-weighted response-schema
  compatibility and missed the old Web producer's different HTTP 408 behavior.
  Runner-first convergence could terminalize an ambiguous request before the
  current runner invited a later explicit request under a new idempotency key.
  Reverse the rollout to migration/current-Web first, where the old strict
  runner fails categorized responses closed to pending, then converge the new
  runner. Add mixed-version and integrated 408 proof without a compatibility
  schema, queue, reconciliation owner, or rollout state.
- Round 6 found that producer-first deployment did not address failed/null rows
  already created by the old HTTP 408 classifier. Production has one such row
  and cannot prove definite rejection from stored state. Treat null as legacy
  ambiguity, block a later provider effect, and reuse the existing 23-hour Lob
  metadata lookup for accepted/absent/indeterminate resolution. This preserves
  the same row and owners without a queue, new state, or repair lifecycle.
- Round 7 found that the first legacy correction returned the older row for a
  distinct current request without recording the current request. Reply loss
  could then replay the unrecorded request after the older row was restored and
  create a new provider effect. Persist the distinct current request first as
  an unsent bounded failure through the existing row/status/reason owner,
  reconcile at most one older row, and always return the current row. Prove the
  current request key and physical-note id survive replay with zero provider
  create and usage calls. This is the seven-round cap; do not start round 8
  without an explicit continuation decision.
- After explicit continuation, round 8 found that accepted-row replay could
  still reconstruct erased legacy billing evidence and that a distinct blocked
  request hid the older acceptance while inviting another send. Make accepted
  replay read-only because ordinary usage commits atomically with acceptance.
  When legacy acceptance blocks a distinct request, persist
  `prior_note_accepted` on the current row and instruct the assistant to report
  both facts without inviting retry. Prove ordinary paid and legacy accepted
  replay add no usage, and prove the distinct request replays the same typed
  no-send disposition with zero provider creates.
- Round 9 found that restoring a legacy row to an ordinary accepted shape
  erased the member-scoped admission discriminator, so a third explicit request
  could mail and charge again. Preserve `prior_note_accepted` on the restored
  row and include only that accepted marker alongside failed/null ambiguity in
  the existing indexed admission guard. It also found that recovery copy
  incorrectly implied both requests shared a recipient and promised an
  investigation with no owner. State only the earlier outcome and current
  no-send fact, name the absence of automatic follow-up, and let only a later
  explicit request recheck unresolved evidence.
- Round 10 found that a request could select legacy row A before the member
  lock, wait while A was resolved, and then fall through to ordinary admission
  even though legacy row B still remained unresolved. Make the existing
  member-locked admission re-read the member-wide guard and repeat the same
  bounded check at final reservation; the real PostgreSQL lock-order proof must
  show B blocks the provider effect. It also found that the rollout allowed old
  Web below a new no-send authority it cannot enforce, so pin current Web as the
  hard rollback floor and require capability disablement plus runner drain for
  any emergency below-floor rollback. Finally, expose the existing accepted
  `prior_note_accepted` marker to the assistant and omit paid, complimentary,
  and cost claims when legacy billing provenance is unavailable. These fixes
  reuse the existing row, enum, member lock, and response surface without a new
  state owner or transaction around provider I/O.
- Round 11 found that current `starting` rows—including a newly ambiguous HTTP
  408 outcome—were outside the member-wide guard. Same-key replay could call
  Lob create again with a refreshed private-media URL, and a distinct request
  could reconcile the first effect as accepted before sending and charging a
  second. Fold every `starting` row into the existing unresolved-effect guard,
  make same-key replay unconditionally pending, and persist distinct requests
  as unsent blockers before any age-gated lookup. Accepted evidence now
  finalizes only the original reservation and its original usage; absence marks
  both rows unknown but never sends the blocked request. Delete the separate
  stale-complimentary repair path and the now-redundant pending-cost aggregate.
  Real PostgreSQL concurrency plus changed-artwork-URL replay prove one Lob
  create and no second provider effect. The correction shrinks production code
  and keeps the existing row, lock, lookup, allowance owner, and reason enum.
- Round 12 found that the Cloudflare physical-note Web-control port still mapped
  every 4xx except 403—including HTTP 408—to a definite failed result without a
  reason. The new assistant recovery copy could then falsely claim nothing was
  sent and invite a later explicit request after Web and Lob had actually
  accepted the first note. Exclude only 408 at the HTTP-status owner so it
  throws into the existing pending path. Focused port and Assistant integration
  tests prove the prior bug and the corrected no-claim, no-retry result. This
  adds no state, enum, queue, compatibility path, or reconciliation mechanism.
- Round 13 found that the restored accepted row's `prior_note_accepted` replay
  marker was also treated as a permanent member-wide admission guard. That
  correctly kept the blocked current request unsent, but it disabled every
  separately authorized future note even though the provider outcome was fully
  resolved. Keep the marker on the accepted row and the blocker for stable,
  billing-neutral replay; delete terminal accepted rows from the unresolved
  guard. Focused Web proof now shows the historical replay and blocker remain
  stable while one later eligible request uses ordinary paid admission and one
  provider create. Assistant guidance scopes no-retry to the blocked request.
- Round 14 found that a distinct blocker committed while the original provider
  call was still in flight remained `prior_note_unresolved` after the ordinary
  provider path accepted or definitely rejected the source row. Settle those
  blockers inside the existing member-locked source terminalizers: acceptance
  uses `prior_note_accepted`, while a successful definite-failure compare-and-
  set uses `unknown` rather than copying a possibly unrelated address or
  artwork category. Real PostgreSQL deferred-provider cases prove both
  interleavings, stable provider-free blocker replay, exact usage ownership,
  complimentary release, and ordinary admission after acceptance. No state,
  link, queue, lifecycle, or reconciliation owner was added.
- Round 15 found that exact replay of a current `starting` row returned pending
  before the existing metadata lookup, so Lob acceptance followed by a failed
  local finalization could never converge. Let only same-key current replay use
  the existing bounded lookup immediately. Accepted evidence finalizes the
  original row and its original paid usage exactly once; recent absence or
  indeterminate evidence keeps authority pending; aged proven absence uses the
  existing unknown transition. Distinct recent requests still perform no
  lookup, and no path re-enters Lob create. Focused tests cover accepted paid
  recovery, recent absent and indeterminate evidence, aged absence, stable
  replay, and changed private-media capability.
- Round 16 found that this exact-row recovery still depended on the replayed row
  also being the member's oldest unresolved guard. Earlier Web versions could
  durably admit more than one `starting` row, so that cardinality remains
  supported during rollout. Exact same-key recovery is therefore row-scoped:
  reconcile its own row independently of the oldest guard that owns new-effect
  admission. Acceptance finalizes that row and its paid usage exactly once;
  every other unresolved row remains untouched and continues blocking new Lob
  creates. A real-PostgreSQL restart case seeds older A plus newer paid B,
  recovers accepted B with one B lookup and zero creates, preserves A, and
  proves a later new request remains blocked. This separates recovery authority
  from admission ordering inside the existing row, member lock, lookup, and
  usage owners, without another state machine or continuation mechanism.
- Round 17 found that production called Web only once, so safe exact replay was
  reachable in tests but not after a committed response was lost or Web returned
  a retryable 5xx. Opt the stable-key physical-note POST into the existing
  one-replay control transport. Both attempts reuse the identical request body
  and key inside the original deadline; HTTP 408 and caller cancellation remain
  single-attempt pending paths. Port proof covers recovered categorized failure,
  recovered acceptance after a lost body, 408, and cancellation. This connects
  the initiating conversation to the existing row-scoped Web recovery without
  a queue, scheduler, notification, or additional continuation owner.
