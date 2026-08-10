# Generated image avatar continuity

Status: active — ReviewGPT round 2 remediation awaiting exact-head review
Created: 2026-08-09
Updated: 2026-08-10

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
- Exact local App Server capture used merge base `dbfa6ae12921` and initial head
  `5623879ce655`, pinned `gpt-5.6-terra`, low reasoning, production code mode,
  identical synthetic direct/group Linq inputs, and `gpt-tokenizer` 3.4.0
  `o200k_harmony`. It counted `include`, `input`, `instructions`,
  `parallel_tool_calls`, `text`, `tool_choice`, and `tools` after normalizing
  paths and unstable ids. The specialist remediation restored two conditional
  required-field phrases; exact serialization of the complete changed group
  tool object added another 27 tokens / 122 bytes to both captured requests.
  Final direct input is 38,236 tokens / 173,483 bytes versus 38,177 / 173,190
  (+59 tokens, +0.1545%; +293 bytes, +0.1692%). Final group input is 30,126 /
  139,622 versus 30,067 / 139,329 (+59 tokens, +0.1962%; +293 bytes,
  +0.2103%). Assembled authored instructions remain byte- and token-identical;
  the complete delta is deferred/eager tool description and generated guidance.
  The current remote base is a descendant of the measured merge base and does
  not change any prompt-bearing input in this comparison.
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
- Exact post-remediation full hosted-local assembly measured a 1,659,616-byte
  entry, 8,016,324-byte static closure, and 9,994,142-byte total without adding a
  forbidden boot input. The static and total ratchets now use those exact
  measurements with the established cross-platform and 32 KiB reviewed-change
  allowances; the 42-test bundle-policy suite and exact assembly both passed.
- Final ReviewGPT round 2 found that Linq's ordinary generated-image delivery
  persists the image alt text as a non-null provider message effect, while the
  reply resolver used a null message as the gate for exact generated-image
  provenance. The recorded retrospective kept the existing outbox, transcript,
  and media owners and reset the invariant: visible fallback text must not erase
  the provider-message-to-exact-media binding.
- The remediation deletes that null-message gate and resolves a matching
  runtime-authored marker before falling back to quoted text. A
  production-shaped regression now creates and dispatches two private images
  with the same ordinary alt text through the real attachment-upload and Linq
  send path, reads their persisted provider effects, and proves a native reply
  to the first delivery exposes only its exact ref and hash while retaining the
  bounded visible text. The focused regression, full 68-test event-path file,
  seven-file affected suite (317 passed, 35 credential-gated skipped), and
  Assistant Engine typecheck pass.
- After merging the latest `main`, the only conflicts were the independently
  updated runner-bundle ratchets. The combined exact hosted-local assembly
  passed at 1,659,616-byte entry, 8,018,416-byte static closure, and
  9,996,234-byte total; the 42-test bundle-policy suite, focused reply
  regression, and affected typecheck also passed on the merged candidate.
