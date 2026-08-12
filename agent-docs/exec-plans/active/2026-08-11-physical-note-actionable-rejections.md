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
  current request as an unsent `unknown` failure under its own request key.
  Always answer with the current row so reply loss and replay cannot turn a
  suppressed request into a provider effect. Do not add an enum, queue, another
  state owner, or a reconciliation lifecycle.
- Cover the member-scoped legacy lookup with an index on member, status, reason,
  and creation time so physical-note history does not create a table-scan hot
  path. The request performs one bounded row lookup and at most one serial
  provider lookup; it never fans out by history cardinality.
- Deploy the additive migration and current Web producer first so the HTTP 408
  ambiguity fix precedes the new recovery behavior. An old strict runner rejects
  a categorized response and fails closed to pending without retry. Then deploy
  the Cloudflare Worker and runner bundle with `container_rollout=immediate` and
  require managed-container smoke proof of the exact new runner-bundle
  fingerprint. Roll back Cloudflare before Web.

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
