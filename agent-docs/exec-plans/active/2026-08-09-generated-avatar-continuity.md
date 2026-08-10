# Generated image avatar continuity

Status: active — ReviewGPT round 8 finding and current-main conflicts under remediation
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
- Final ReviewGPT round 3 found that one Linq intent can split into a primary
  image/text bubble and a link-only provider sibling while the reply projection
  copied parent-intent media onto both physical ids. The remediation preserves
  the ordered persisted provider ids, treats only the first physical message as
  the media owner, strips media from every matched sibling effect, and gives a
  null-text sibling a neutral exact-reply context rather than an unseen-media
  claim. Ambiguous legacy multi-effect records fail closed with no media owner.
- The production-shaped split regression now dispatches one generated vault
  image plus terminal link through the real attachment reservation/upload,
  primary send, link send, provider-effect persistence, and outbox reload. It
  proves the primary reply receives the exact ref/hash and bounded visible text
  while the link reply receives neither image identity nor a media claim. The
  existing-chat event-path file passes 68 tests; the Operator Config Linq file
  passes 64 tests and proves created-chat media likewise stays on the ordered
  primary message. Both affected package typechecks pass.
- The first exact assembly exposed a 230-byte vault CLI budget overage from the
  initial remediation. Collapsing duplicate reply-context rendering and using
  the ordered id array itself as the media-owner proof avoided a ratchet change.
  Final exact assembly passes at 8,999,581-byte vault CLI total and a
  1,659,616-byte runner entry, 8,018,907-byte static closure, and
  9,996,725-byte runner total.
- Final ReviewGPT round 4 found that ordered position is not a generic physical
  media-owner fact: successful Linq text-plus-voice delivery sends the text
  first and the actual voice memo second, so the round-3 index-zero heuristic
  erased exact media context when a member replied to the voice bubble. The
  required retrospective records the corrected invariant on PR #1533 before
  remediation.
- The correction deletes positional ownership inference and adds one optional
  true-only fact to the existing provider-message effect. The Linq body owner
  sets it when a physical message includes intent media; the dedicated voice
  endpoint owner sets it on its single successful effect. Multi-message records
  without the fact retain no media, while single-message legacy deliveries stay
  unambiguous. No database migration, queue, service, state machine, or new
  authority owner is introduced.
- A production-shaped regression now dispatches text plus a voice memo through
  the real Linq message and dedicated voice endpoints, reloads the persisted
  outbox intent, and resolves native replies to both physical ids. The text
  reply receives only attested text; the voice reply receives the exact
  media/no-text context without transcript, filename, or provider-id leakage.
  The split voice-fallback and both generated-image primary/link journeys remain
  green.
- Focused verification passes 318 Assistant Engine tests with 35 explicit
  live-provider cases skipped behind their credential gate, the 64-test
  Operator Config Linq runtime file, and both affected package typechecks.
  After removing redundant projection code instead of raising a ratchet, exact
  hosted-local assembly passes at 8,999,629-byte vault CLI total and a
  1,659,616-byte runner entry, 8,018,955-byte static closure, and 9,996,773-byte
  runner total.
- Exact-head CI exposed the expected downstream generated-artifact seam: the
  provider-effect schema changed the built CLI fingerprint, but the tracked
  Vault CLI skill hash still described the previous tree. The canonical Incur
  generator changed only `vault-cli-skill-hash.generated.ts`; exact package
  shape verification and the two focused skill-hash tests pass. The stale-head
  ReviewGPT run was stopped before a result and will restart on the corrected
  pushed head.
- Delivery equality now compares the optional media-owner fact so mirror
  reconciliation cannot treat marked and unmarked physical effects as the same
  persisted result. Its focused 29-test dispatch-state file and the Assistant
  Engine typecheck pass.
- Exact-head platform coverage then exposed two stale deep-equality fixtures in
  the hosted provider recovery suite. Both recover a physical image message,
  so their returned effect correctly carries the new true-only media fact; only
  the expected shapes changed. The complete 23-test file and Assistant Runtime
  typecheck pass.
- Final ReviewGPT round 5 accepted the forward physical-owner behavior but found
  a review-induced rollback defect: the previous strict provider-effect reader
  quarantines a marked sent intent, and idle snapshot maintenance then excludes
  that quarantine from portable continuity. The required retrospective was
  recorded on PR #1533 before remediation.
- The correction uses the existing `RunnerStateStore` construction gate rather
  than a compatibility service. Hosted runner schema version 16 is written
  before any invocation or workspace access; a version-15 Worker rejects it
  before it can wake an old runner or quarantine a marked outbox record.
  Production immediate rollout, exact runner-fingerprint admission, durable
  architecture/deploy contracts, and focused floor proof make version 16 the
  enforced forward-fix rollback floor.
- The two focused Cloudflare files pass 98 tests, the Cloudflare package
  typecheck passes, docs drift passes, and the workspace diff has no whitespace
  errors.
- The latest `main` merged without conflicts. Post-merge verification passes
  the seven-file Assistant Engine suite (318 passed, 35 credential-gated
  skipped), Assistant Engine and Cloudflare typechecks, and the two-file
  98-test Cloudflare floor/preflight suite. Exact hosted-local assembly passes
  at 8,999,437-byte vault CLI total and a 1,659,616-byte runner entry,
  8,019,870-byte static closure, and 9,996,978-byte runner total without a
  budget change.
- Final ReviewGPT round 6 accepted the rollback-floor proof and found one
  remaining review-induced delivery gap: Linq retains an accepted primary
  image when its terminal rich-link sibling fails, but the partial checkpoint
  discarded the new physical media-owner effect and exact reply lookup admitted
  only fully sent intents. A member replying to the visible image before the
  scheduled link retry therefore lost an otherwise exact media join.
- The correction carries the primary effect through the existing Linq partial
  error and delivery checkpoint, then admits only an explicit Linq native reply
  to a retryable, non-confirmation-pending delivery with an exact marked media
  effect. Generic retryable or confirmation-pending records remain excluded;
  no new state owner or positional inference was added.
- Production-shaped proof uses the real Linq attachment, primary-message, and
  rich-link endpoints, persists and reloads the one-id retryable checkpoint,
  resolves a pre-retry native reply under fresh planning with a second generated
  image present, and then converges on the same provider idempotency keys. The
  primary is accepted once, the link sibling never inherits media, and the
  already-processed inbound is not replayed. Seven affected files pass 372
  tests, and the Assistant Engine and Operator Config typechecks pass.
- The first exact assembly exposed a 961-byte vault CLI overage. Reusing the
  existing effect parser and deleting redundant private error-call fields kept
  the same persisted evidence without raising a ratchet. Final hosted-local
  assembly passes at 8,999,779-byte vault CLI total, 1,659,616-byte runner
  entry, 8,020,212-byte static closure, and 9,997,320-byte runner total; the
  42-test bundle-policy file and docs drift check pass.
- The first attempted round-7 capture did not produce a valid exact-head result.
  A supported same-thread export later exposed a completed response, but it
  explicitly checked older head `a8807b6ef2` rather than the intended
  `a0f8d3044d` candidate and lacked concrete model confirmation. It is retained
  as diagnostic evidence only; it does not advance the substantive round or
  provide the required final `PASS`.
- That stale response nevertheless identified one ORIGINAL_PR ordering defect
  which parent inspection reproduced before changing source: completion
  finalization persists native-resume and fresh-history exact refs before the
  matching outbox media becomes visible, so a later accepted avatar request
  could publish and mutate from a still-pending generated image. A focused
  production-boundary test first failed by allowing the pending intent through
  the real group preflight, private-publication boundary, and mutation request.
- The correction derives eligibility from the two existing owners at the group
  effect boundary. When a `raw/captures/**` ref matches a runtime-authored
  generated-completion marker, the current session must also contain the exact
  marker turn and ref/hash/type/size on a delivered outbox intent. Sent delivery
  qualifies; the only non-terminal exception is the existing narrowly attested
  Linq accepted-primary checkpoint whose physical effect explicitly carries
  intent media. Pending, failed, unmarked retryable, confirmation-pending, and
  unreadable state fail closed before private publication or group mutation.
  Healthy ordinary capture refs with no generated-completion marker preserve
  the prior path. No queue, state owner, lifecycle, migration, or compatibility
  surface was added.
- Native explicit replies now use their already provider-id-bound delivered
  outbox media directly instead of re-reading and rejoining the transcript
  marker. The transcript marker remains the committed-history fallback and is
  labeled truthfully as neither delivery nor effect authority. This deletion
  keeps physical delivery proof and fallback provenance separate while
  preserving current-input effect authority.
- The focused boundary regression persists the real marker and outbox intent,
  proves pending delivery blocks publication and mutation, checks failed and
  unmarked retryable states, preserves the marked accepted-primary exception,
  transitions the same exact intent to sent, and proves the existing avatar
  path then succeeds. Six affected Assistant Engine files pass 262 tests and
  the package typecheck passes. The 42-test runner bundle policy passes.
- The first delivery-eligibility assembly exceeded the immutable vault CLI
  budget by 4,297 bytes. Collapsing the redundant native-reply transcript join,
  sharing the existing sent/attested-delivery predicate, using one fail-closed
  boolean at the hosted boundary, and tightening the already changed generated-
  image tool prose preserved its safety and scheduling rules without raising a
  ratchet. The latest assembled candidate passes at 8,999,814-byte vault CLI
  total, 1,659,616-byte runner entry, 8,019,855-byte static closure, and
  9,997,355-byte runner total.
- Provider-visible input remains derived from the original complete pinned App
  Server capture because no other initial-request field changed. Exact
  serialization of the two complete changed tool objects with `gpt-tokenizer`
  3.4.0 `o200k_harmony` removes 173 tokens and 767 bytes from both captured
  requests relative to the previously measured candidate. Against the same
  immutable base, final direct input is 38,063 tokens / 172,716 bytes versus
  38,177 / 173,190 (-114 tokens, -0.2986%; -474 bytes, -0.2737%). Final group
  input is 29,953 / 138,855 versus 30,067 / 139,329 (-114 tokens, -0.3792%;
  -474 bytes, -0.3402%). The delta remains entirely tool/schema/generated
  guidance; assembled authored instructions are unchanged.
- A fresh round-7 full snapshot was packaged at `a0f8d3044d` before the
  independently running delivery-eligibility correction advanced the PR to
  `960c898fb7`. The response therefore does not certify the current head, but
  it returned one review-induced finding that parent inspection reproduced on
  the current shared delivery-evidence predicate: an accepted Linq image effect
  survives while its outbox intent becomes `sending` and then terminal
  `failed`, yet the explicit native-reply reader and direct generated-ref avatar
  gate discarded it because they admitted only `retryable` non-sent evidence.
  The requested model was `gpt-5.6-sol`; wrapper verification observed
  `gpt-5-6-pro`. The response ended `ROUND_OUTCOME: FINDINGS`.
- The required repeated-mechanism retrospective was recorded before
  remediation at https://github.com/cobuildwithus/murph/pull/1533#issuecomment-5240669791.
  It retains the existing outbox as the sole physical-delivery owner and rejects
  a new state machine, schema, queue, lifecycle, reconciliation pass,
  compatibility path, or positional inference.
- Focused proof failed before the correction in both affected consumers. The
  production-shaped native-reply case accepted the primary image, exhausted all
  three transient link attempts, retried at `nextAttemptAt`, received a terminal
  primary response, persisted `failed` with the original exact provider ID and
  marked media effect, then lost the ref/hash when the accepted native reply was
  scanned. Direct generated-ref avatar eligibility likewise rejected the same
  retained effect in `sending` and `failed`.
- The correction broadens only the existing opt-in physical-evidence predicate:
  `retryable`, `sending`, and `failed` qualify when confirmation is not pending,
  the delivery is Linq, and exactly one accepted provider effect carries intent
  media. `pending`, `awaiting_approval`, `abandoned`, missing delivery,
  confirmation-pending, unmarked, duplicate-owner, unknown-ID, and adjacent
  sibling shapes fail closed. Sent delivery remains unchanged, and generic
  outbox readers remain sent-only.
- The image/link regression now retains both pre-retry convergence and the
  terminal-before-reply-scan ordering. Both reuse the same primary/link
  idempotency keys, accept the primary only once, keep the link sibling
  unmarked, select only the replied image when another generated capture exists,
  and never replay the inbound input. A run-loop assertion proves due outbox
  work settles before foreground refresh and scan; the group boundary exercises
  the same shared evidence across `sending`, `failed`, and negative states.
- Seven affected Assistant Engine files pass 499 tests and package typecheck
  passes. The 42-test runner bundle-policy file passes. Exact hosted-local
  assembly passes without a ratchet change at 8,999,924-byte vault CLI total,
  1,659,616-byte runner entry, 8,019,965-byte static closure, and 9,997,465-byte
  runner total.
- The seven-round hard-cap retrospective and explicit continuation decision are
  recorded at https://github.com/cobuildwithus/murph/pull/1533#issuecomment-5241117061.
  The decision is to continue because reverting or splitting would leave the
  exact generated-image journey or a proven authority/delivery invariant
  unresolved, while the current shape reuses existing owners and adds no queue,
  state machine, reconciliation service, database owner, or compatibility
  subsystem.
- The first round-8 invocation was invalid and does not advance the substantive
  counter. A concurrent docs-only plan commit advanced the checkout while the
  packager was building the preceding behavior head, so the ZIP correctly
  rejected its old diff/new plan-file mismatch before substantive review. Retry
  round 8 only from one clean, stable, exact pushed head.
- The valid round-8 full audit found one review-induced delivery bypass. A
  trusted ready completion could finish without attaching its exact capture,
  retain provider continuity, and leave no generated-image marker. The later
  avatar verifier intentionally permits markerless ordinary captures, so the
  retained generated ref could cross publication without outbox visibility.
- The correction keeps the existing transcript and outbox owners. Every trusted
  ready completion now persists the existing exact provenance marker; attached
  media keeps its actual delivery ordinal, while an unattached completion uses
  the completion turn's response ordinal. The marker still authorizes nothing,
  and an empty or mismatched outbox therefore rejects the generated ref. Focused
  proof covers no-reply continuity, exact marker persistence, empty-outbox
  rejection, mismatched response media, and the existing group boundary before
  publication or mutation.
- Current `main` introduced four textual conflicts. The hosted-image test keeps
  both the branch's bounded completion-copy assertions and main's origin-parser
  assertions. Runner-bundle policy temporarily keeps the larger previously
  measured branch ceilings until exact post-merge assembly remeasures the
  combined graph. The generated CLI hash will be regenerated from the resolved
  built tree rather than choosing either stale side.
- The first exact post-merge assembly stopped at the Vault CLI size guard:
  9,028,740 bytes exceeded the historical 9,000,000-byte ceiling. The measured
  growth is the combination of this PR's reviewed generated-image continuity
  and main's shipped Health Commons knowledge command; both remain lazy CLI
  capabilities and no new package entered the graph. Recovering 28,740 bytes
  would require deleting part of either current feature, so the deliberate
  correction raises the ceiling to 9,100,000 bytes, which remains below the
  guard's original 30-percent headroom policy. Exact assemble-only proof must
  still pass the CLI and runner entrypoint graph guards before push.
- Exact assemble-only proof then passed: Vault CLI 9,028,740 of 9,100,000
  bytes; runner entry 1,670,920 bytes, static closure 8,041,446 bytes, and total
  10,022,379 bytes. The combined total becomes the new measured runner baseline
  with the existing 32 KiB reviewed-addition allowance; the entry and static
  measurements remain inside their established tolerances and no forbidden
  boot input entered the graph.
- `main` advanced by four additional merged PRs during verification. The second
  ordinary merge had no conflicts. Fresh full assembly on that exact merged
  tree passes: Vault CLI 9,030,122 of 9,100,000 bytes; runner entry 1,672,620
  bytes, static closure 8,045,861 bytes, and total 10,026,794 bytes. The current
  exact total is the final measured runner baseline with the same 32 KiB
  allowance.
