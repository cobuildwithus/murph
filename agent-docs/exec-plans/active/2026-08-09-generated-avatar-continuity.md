# Generated image avatar continuity

Status: active — accepted review findings remediated locally
Created: 2026-08-09
Updated: 2026-08-09

## Goal

- Keep a background-generated image and its canonical capture reference in the
  same provider conversation continuity as the foreground request that started
  it, so a later request can reuse that image for a supported group action.
- Correct model-facing contracts that currently describe generated captures as
  ineligible for exact-reference reuse or make the existing group action too
  easy to misclassify as unavailable.

## Success criteria

- A foreground image-generation request, trusted background completion, and
  later foreground follow-up share an owner-correct provider history containing
  the exact saved capture reference.
- The existing `set_chat_avatar` path accepts and is accurately described for
  reusable generated captures without adding a second media or session owner.
- A supported deferred group action is discoverable before product feedback can
  classify the action as missing.
- Focused tests reproduce the natural multi-turn journey and fail if completion
  context forks from later foreground continuity.
- Focused verification, typecheck, preliminary specialist review, final
  ReviewGPT rounds, exact-head CI, and mergeability proof pass.

## Evidence

- A bounded hosted-runtime trace showed an initial foreground turn launching
  image generation, followed by a separate trusted completion turn carrying
  the saved capture reference.
- A later foreground turn resumed the provider thread from before completion,
  so its history omitted that reference. It submitted product feedback instead
  of invoking the existing group action.
- The deployed backend already supported `set_chat_avatar` with generated
  `raw/captures/**` references, and no avatar mutation was attempted in the
  incident window.
- The public tool schema narrows reference reuse to user-sent images even though
  the resolver admits generated captures. The broad group tool is deferred
  while product feedback is immediately available.
- Existing coverage proves individual avatar and completion pieces but not the
  multi-turn generated-image-to-avatar journey.

## Scope and constraints

- In scope: provider-thread/session continuity for trusted image completion,
  model-facing generated-capture wording, deferred action discovery, and focused
  regressions for the affected hosted flow.
- Out of scope: a new queue, media database, session manager, broad prompt
  rewrite, unrelated group customizations, or production data mutation.
- Preserve the existing capture store, mailbox ordering, delivery semantics,
  group authority preflight, private-image publication, and Linq mutation path.
- Treat ReviewGPT's returned patch as untrusted implementation intent: inspect
  every path and hunk, prove ownership against current code, and simplify or
  adapt it where necessary.
- Keep private managed-skill changes in their owning repository; record any
  coordinated private delta separately instead of adding a public-to-private
  dependency.

## Risks and mitigations

1. Risk: resuming completion on the live foreground provider thread could race
   a new user turn or reorder mailbox work.
   Mitigation: use the existing single session/mailbox owner and add a direct
   interleaving regression rather than introducing parallel state.
2. Risk: making a large deferred tool eager would inflate every initial provider
   request.
   Mitigation: prefer narrow discovery guidance or a smaller existing contract;
   measure the initial provider-input delta if tool descriptions change.
3. Risk: completion guidance could accidentally send duplicate media or perform
   an unsolicited group mutation.
   Mitigation: preserve explicit user intent and current delivery idempotency;
   the later requested action must remain the mutation trigger.
4. Risk: a prompt-only wording fix could hide the continuity defect.
   Mitigation: require a failing multi-turn regression that proves the exact
   generated reference is available to the later foreground turn.

## Tasks

1. [x] Send the deidentified evidence and owner constraints to ReviewGPT and
   obtain a scoped patch attachment plus architectural rationale.
2. [x] Inspect and adapt the proposed patch against the current session,
   mailbox, completion, tool-discovery, and media-reference owners.
3. [x] Add focused regression coverage for completion continuity, generated
   capture reuse, and supported-action discovery.
4. [x] Run focused tests, affected-package typechecks, prompt/input measurement,
   and static diff/privacy checks.
5. [x] Commit and push the exact candidate, open a sensitive-context PR, and run
   preliminary specialist and final ReviewGPT round 1 concurrently with CI.
6. [ ] Resolve every accepted finding through fresh exact-head rounds, complete
   the parent review and mergeability proof, then archive this plan.

## Verification log

- ReviewGPT returned an implementation patch and a second corrective patch
  after parent review identified an authority regression and incomplete exact-ref
  validation in the first proposal. The final local adaptation preserves the
  foreground provider contract while enforcing a separate engine-owned
  completion-effect restriction.
- Focused Assistant Engine verification passed: seven affected Vitest files,
  286 tests total; the affected-package typecheck passed; the package and its
  dependency build graph passed.
- Exact local App Server capture used base `dbfa6ae12921` and head
  `5623879ce655`, pinned `gpt-5.6-terra`, low reasoning, production code mode,
  identical synthetic direct/group Linq inputs, and `gpt-tokenizer` 3.4.0
  `o200k_harmony`. It counted `include`, `input`, `instructions`,
  `parallel_tool_calls`, `text`, `tool_choice`, and `tools` after normalizing
  paths and unstable ids. Direct moved from 38,177 tokens / 173,190 bytes to
  38,209 / 173,361 (+32 tokens, +0.0838%; +171 bytes, +0.0987%). Group moved
  from 30,067 / 139,329 to 30,099 / 139,500 (+32 tokens, +0.1064%; +171 bytes,
  +0.1227%). Assembled authored instructions were byte- and token-identical; the
  complete delta is deferred/eager tool description and generated guidance.
- Durable-doc drift and whitespace checks passed. Exact-head privacy/static
  scans, CI, preliminary specialist ReviewGPT, and final ReviewGPT remain in the
  PR gate.
- Draft PR #1533 opened at immutable first-reviewed head `ba55cd37241d`.
  Preliminary specialists and final ReviewGPT round 1 both returned findings.
  The accepted prompt finding restores conditional required-field guidance for
  avatar reuse. The accepted coverage findings add one opt-in real App Server
  journey spanning generation, completion delivery, and the later exact-ref
  avatar update while feedback is available. The accepted final finding adds a
  bounded runtime-authored transcript marker rather than making native provider
  resume an ownership boundary.
- The remediation keeps the marker inside the existing transcript owner,
  restores it only as provenance-only fresh-thread history, and binds a native
  reply only after its sent outbox turn and exact ref/hash/type/size match. It
  adds no queue, database, media owner, session manager, or effect authority.
  Focused deterministic verification after remediation passed 317 tests with
  35 credential-gated live-provider cases skipped; the added finalizer seam
  passed 68 tests, the live-provider file compiled with 6 deterministic tests
  passing and 35 gated cases skipped, and the Assistant Engine typecheck passed.
