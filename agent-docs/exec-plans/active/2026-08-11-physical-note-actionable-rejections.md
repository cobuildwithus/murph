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
- Pre-migration failed rows without a reason remain pending until the existing
  Lob metadata lookup proves acceptance or absence, and block a later provider
  effect while indeterminate.
- Existing accepted, pending, permission, unavailable, and usage behavior stays
  unchanged.

## Architecture

- Extend the existing physical-note contract with one nullable failure-reason
  enum; do not add a workflow, queue, retry owner, fallback provider, or second
  state owner.
- Parse only Lob's bounded allowlisted error code. Never propagate or persist its
  freeform message.
- Add one nullable column to `hosted_physical_note` so a definite rejection has
  the same answer on the original call and every replay. Null on an existing
  failed row is the legacy-ambiguity marker, not an unknown definite rejection.
- Before replay or a later send for the same member, resolve at most one legacy
  row through the existing Lob lookup after 23 hours. Proven absence persists
  `unknown`, proven acceptance restores the same row without an unsupported
  historical charge, and indeterminate evidence stays pending for the same
  request. Before reconciling an older row for a distinct request, persist that
  current request as an unsent `prior_note_unresolved` failure under its own
  request key, so a concurrent replay cannot invite another send. Proven
  absence narrows that current reason to `unknown`.
  If the older row is proven accepted, narrow the current row to the existing
  bounded reason vocabulary's `prior_note_accepted` state and tell the member
  both that the older note was accepted and the current request was not sent.
  Accepted replay is read-only; ordinary paid acceptance already commits usage
  atomically, while restored legacy acceptance has no billing provenance to
  reconstruct. Always answer with the current row so reply loss and replay
  cannot turn a suppressed request into a provider effect. Do not add another
  enum, queue, state owner, or reconciliation lifecycle.
- Re-read the member-wide legacy guard after taking the existing member lock
  and again at final reservation admission. A row selected before the lock is
  only a hint; resolving it cannot authorize a send while another guard still
  exists. Keep provider lookup outside the transaction.
- Cover the member-scoped legacy lookup with an index on member, status, reason,
  and creation time so physical-note history does not create a table-scan hot
  path. The request performs one bounded row lookup and at most one serial
  provider lookup; it never fans out by history cardinality.
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
