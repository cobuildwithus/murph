# Actionable physical-note rejections

## Goal

When Lob definitely rejects a physical note, tell the member what category of
problem prevented printing and what they can safely do next, while preserving
the existing one-effect, replay, privacy, and complimentary-claim guarantees.

## Proven production symptom

- One explicit physical-note request reached the Web owner, created exactly one
  durable reservation, and received a definite provider rejection before any
  provider letter id existed.
- The failed row released its complimentary claim as designed.
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
- Existing accepted, pending, permission, unavailable, and usage behavior stays
  unchanged.

## Architecture

- Extend the existing physical-note contract with one nullable failure-reason
  enum; do not add a workflow, queue, retry owner, fallback provider, or second
  state owner.
- Parse only Lob's bounded allowlisted error code. Never propagate or persist its
  freeform message.
- Add one nullable column to `hosted_physical_note` so a definite rejection has
  the same answer on the original call and every replay. Existing failed rows
  remain compatible with a null reason and use the unknown recovery path.
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
  for definite rejection, and legacy null compatibility.
- Assistant tool tests prove each member-facing recovery path and preserve the
  pending no-retry instruction.
- Focused Hosted Execution, Web, Assistant Engine, and Cloudflare tests pass:
  6, 85, 15, and 5 tests respectively. Prisma validation and generation pass,
  as do all four affected package/app typechecks. The opt-in real-model journey
  compiles and selected the exact test locally, but its paid execution is
  blocked when the provider credential is absent; deterministic owner tests
  remain the authoritative local proof.
- Complete first-provider request capture used the pinned real Codex App
  Server, local scripted provider, `gpt-5.6-terra`, low reasoning, production
  code mode, an explicit physical-note request, and `gpt-tokenizer` 3.4.0
  `o200k_harmony`. It counted `include`, `input`, `instructions`,
  `parallel_tool_calls`, `text`, `tool_choice`, and `tools` after normalizing
  temporary paths and unstable ids. Direct is unchanged at 24,507 tokens /
  112,170 bytes; group is unchanged at 20,928 / 96,389. The skill recovery
  text and tool-result instruction enter only after a failed tool call, so
  assembled initial instructions, tool schemas, and generated guidance are
  byte-identical. Model selection, reasoning, storage, streaming, service-tier,
  cache, account, client, and transport metadata were excluded identically.

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
