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
- Deploy the tolerant Cloudflare/runner consumer first, then the additive Web
  migration and response producer. The new response field is optional so the
  new consumer accepts older Web responses; older warm runners ignore the
  added result property after the Worker validates it. Do not deploy the new
  strict Web response through an older Worker parser.

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
  6, 50, 13, and 5 tests respectively. Prisma validation and generation pass,
  as do all four affected package/app typechecks.
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
