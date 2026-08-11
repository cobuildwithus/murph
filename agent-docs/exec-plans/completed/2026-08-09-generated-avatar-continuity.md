# Generated image avatar continuity

Status: completed
Created: 2026-08-09
Updated: 2026-08-11

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
- Final focused proof on the exact candidate passes: 439 Assistant Engine tests
  with 47 credential-gated live-provider cases skipped, 66 Operator Config Linq
  tests, 42 runner bundle-policy tests, CLI package-shape verification, Assistant
  Engine/Operator Config/Cloudflare typechecks, docs drift, whitespace checks,
  merge-tree proof, and candidate privacy/secret scans. The worktree is clean;
  push, exact-head CI, and substantive ReviewGPT round 9 remain.
- Final ReviewGPT round 9 found that generated-origin provenance could disappear
  at two boundaries: the restriction builder rejected the intentionally
  completion-first compound batch, and bounded transcript retention could later
  remove the marker while the generated capture remained live. The repeated-
  mechanism retrospective was recorded before remediation at
  https://github.com/cobuildwithus/murph/pull/1533#issuecomment-5243496768.
- Focused tests failed before the correction. A runtime-shaped trusted
  completion plus later authenticated group input received no effect
  restriction, and a known-generated ref with no retained marker inherited the
  ordinary capture path despite having no delivered outbox intent.
- The correction derives provenance from existing owners only. Exactly one
  trusted completion retains its restriction through a compound batch. The
  later group boundary classifies the requested ref as generated from that
  in-flight restriction or the lazily materialized generated-capture lookup;
  it then requires the existing same-session singleton outbox intent and
  accepted physical-delivery evidence. A retained marker keeps the stricter
  turn/ref/hash/type/size join, while a trimmed marker recovers through exact-ref
  outbox evidence. Ordinary refs absent from the marker, restriction, and lookup
  keep their existing path. No queue, database, state machine, alternate
  delivery owner, or retention exception was added.
- The two initial regressions now pass within a 176-test focused suite;
  Assistant Engine and Core package typechecks pass, and the two Core capture
  owner files pass 13 tests. The complete affected Assistant Engine set passes
  623 tests with 47 credential-gated live-provider cases skipped. The full
  Cloudflare Node lane passes 2,376 tests with two expected skips; docs drift,
  whitespace, and package builds pass.
- Exact hosted-local assembly after the correction passes without a ratchet
  change: Vault CLI 9,031,808 bytes of 9,100,000; runner entry 1,672,620 bytes;
  static boot closure 8,047,551 bytes; total 10,028,548 bytes of 10,059,562;
  no forbidden boot input entered the graph. Round 10 full-patch review,
  exact-head CI, and final mergeability proof remain.
- Current `main` then advanced twice. The first ordinary merge combined the
  reviewed bundle ceilings with main's newer entry/static baselines and
  regenerated the CLI skill hash from the built command tree; the second had
  only that generated-hash conflict and used the same canonical generator.
  No PR behavior source conflicted. Post-merge proof passes the 176-test
  compound/delivery suite, Assistant Engine typecheck, nine focused CLI hash
  tests, CLI package-shape verification, and 50 runner bundle-policy tests.
- Exact full assembly on the final merged tree passes at 8,690,837-byte Vault
  CLI total, 1,596,214-byte runner entry, 7,728,184-byte static boot closure,
  and 9,619,852-byte runner total with no forbidden boot input. Round 10 must
  review the pushed merged head; exact-head CI and final mergeability remain.
- Exact-head CI exposed two completion-only gaps. The PR lacked its required
  member-visible changelog disposition, and the new authority tests built raw
  App Server tool-call envelopes without the request/call/thread/turn identity
  required by the release-package lane. The correction publishes one bounded
  August 10 changelog item for explicit, visible generated-image group-photo
  reuse and routes those tests through the existing canonical test request
  builder; production behavior is unchanged.
- Changelog and product-feedback archive proof passes 44 tests, the corrected
  Assistant Engine authority file passes three tests, and the full Web
  typecheck passes after running its required Health Commons and Prisma
  generators. The earlier prepared-only typecheck was invalid because its
  generated Prisma prerequisite was absent.
- The first round-10 invocation against the pre-correction head ended without
  a response artifact and does not advance the substantive review counter.
  Round 10 must be retried as a sensitive fresh full-snapshot audit on the next
  exact pushed head while exact-head CI runs concurrently.
- `main` advanced through the managed-voice-runtime, sponsorship-metrics, and
  iMessage nutrition-card changes. An ordinary merge retained this PR's
  generated-image continuity and changelog item alongside those accepted
  mainline changes. Post-merge focused proof passes 69 Assistant Engine and
  Operator Config tests plus 44 changelog/archive tests.
- Fresh full hosted-runner assembly on the merged tree passes with no ratchet
  change: Vault CLI 8,689,343 bytes of 9,100,000; runner entry 1,596,214 bytes;
  static boot closure 7,726,737 bytes; total 9,618,405 bytes of 10,073,587.
  The 42-test runner bundle-policy file passes and the final bundle contains no
  forbidden boot input.
- Exact-head release CI then found one stale archive assertion introduced by
  the required changelog correction: the changelog page still expected the
  prior August 10 edition title. The test now expects the member-visible title
  and the new stable item anchor. The three focused changelog/page/feedback
  files pass 52 tests; production source is unchanged by this correction.
- Exact-head CI is fully green on `fc6ff94bbcd2`, including release, coverage,
  frontend proof, billing, sandbox, and artifact lanes. A first round-10 retry
  ended without an artifact. A second retry omitted the mandatory guarded PR
  context metadata and correctly returned `ROUND_OUTCOME: INVALID`; a further
  full-snapshot preflight rejected an old context anchor before sending. These
  tooling/invocation failures do not advance the substantive round.
- The valid sensitive round-10 full snapshot exactly reviewed `fc6ff94bbcd2`
  with the immutable first-reviewed head and prior-finding ledger present. The
  wrapper verified requested `gpt-5.6-sol` and response `gpt-5-6-pro`; the
  result ended `ROUND_OUTCOME: FINDINGS` with two accepted defects. Adjacent
  trusted completions could be grouped together, causing the exact-one
  completion restriction builder to fail open into later foreground group
  authority. Separately, a retained no-attachment provenance marker required
  a later exact delivery intent to share the original completion turn id, so a
  real later-turn delivery of the same immutable media remained ineligible.
- The repeated-mechanism retrospective was recorded before the remaining
  source correction at
  https://github.com/cobuildwithus/murph/pull/1533#issuecomment-5246231513.
  It preserves existing grouping, transcript, and outbox owners and rejects a
  multi-completion authority shape, queue, manager, state machine, lifecycle,
  compatibility path, or alternate delivery truth.
- Focused pre-fix grouping proof failed one new assertion while the other 15
  grouping cases passed: completion A incorrectly grouped with completion B.
  The correction adds one early return to the existing adjacency predicate, so
  each completion starts its own batch while the final completion can still
  fold its later same-route foreground input. The delivery correction deletes
  only original-turn equality from the strict marker join while retaining same
  session, exact ref/hash/type/size, and accepted physical-delivery evidence.
  Both focused files pass 115 tests, including later-turn positive and
  wrong-session/hash negative cases.
- Current `main` then merged with one overlapping live-provider test conflict.
  The resolution preserves this PR's complete generated-image journey plus
  main's fresh shared-data and detached-consultation cases. The merged six-file
  Assistant Engine set passes 270 tests with 55 live-provider cases skipped
  behind their explicit gate, and the Assistant Engine typecheck passes.
- Round 10 also noted that the member-visible changelog is a rendered Web
  surface despite the prior frontend-lens declaration. The existing synthetic
  changelog design study now renders the generated-group-photo feature card
  through the real archive component without live data or requests; no
  production UI component or behavior changed. Its two catalog/changelog files
  pass 18 tests.
- Exact merged-head runner proof passes 67 bundle-policy tests. Fresh full
  assembly passes every CLI parity probe at 8,690,580-byte Vault CLI total,
  1,596,168-byte runner entry, 7,727,794-byte static boot closure, and
  9,619,462-byte runner total without a ratchet change. The full Web typecheck,
  docs drift, whitespace, and candidate privacy/static checks pass.
- A latest-package ReviewGPT 0.5.124 round-11 attempt ran for roughly 66 minutes
  against exact pushed head `409d0da7baba`. The wrapper verified requested
  `gpt-5.6-sol` and response `gpt-5-6-pro`, but the response emitted unsupported
  `ROUND_OUTCOME: FAIL` rather than an allowed final-gate token, so it does not
  advance the substantive counter or satisfy the merge gate. Its single
  diagnostic finding was nevertheless reproduced against the production turn
  runner: the completion restriction denied Murph dynamic effects while the
  provider attempt still inherited the foreground native Codex sandbox and
  capability set.
- The accepted correction reuses the turn runner's existing read-only sandbox
  and native-capabilities-disabled thread config only while the trusted image
  completion scope is current. Because native resume does not resend thread
  config, the same existing capability disables are appended to process config
  after any requested overrides; injected environments and hosted fetch
  adapters are removed for the completion. Native resume, the hosted tool
  context, workspace materializer, progress delivery, private-image
  requirement, and exact media or physical-note dynamic paths remain wired.
  When a later accepted foreground input is already current, the existing
  scope reader restores the ordinary native route. No owner, queue, state
  machine, compatibility path, or alternate authority source was added. The
  provider-boundary regression first failed with `danger-full-access` and no
  thread config, then exposed the still-enabled process overrides after the
  partial correction; it now passes all 23 focused tests while preserving the
  resume id and exact hosted effects.
- Current `main` advanced again while the correction was in progress. The
  ordinary merge preserved both this PR's generated-group-photo changelog item
  and main's Starter, web-search, and appointment-reminder entries. The two
  focused changelog files pass 39 tests after the three-file resolution.
- Post-merge inspection found that current `main` had strengthened the same
  native restriction boundary with process-level config overrides. The
  combined correction appends the full native-disable set after requested
  overrides for the trusted completion, removes its hosted fetch adapters, and
  keeps the hosted effect context, materializer, progress delivery, private-
  image requirement, native resume, and later foreground route intact. Five
  affected runner files pass 397 tests; the Assistant Engine typecheck passes.
  The merged Web changelog/design proof set passes 53 tests, and the full Web
  typecheck passes after its required Health Commons and Prisma generators.
- Post-correction verification passes 281 tests across the seven affected
  Assistant Engine files with 55 explicitly credential-gated live-provider
  cases skipped, plus the Assistant Engine typecheck and 42 runner bundle-
  policy tests. Fresh exact assembly passes every CLI parity probe at an
  8,691,853-byte Vault CLI total, 1,596,168-byte runner entry, 7,729,067-byte
  static boot closure, and 9,620,735-byte runner total without a ratchet
  change. Docs drift, whitespace, and candidate identifier/secret scans pass.
- The valid sensitive round-11 full snapshot exactly reviewed pushed head
  `54e026cf2777`. Its one accepted review-induced finding proved that a later
  foreground input could be live-steered into an already-running completion
  attempt whose native sandbox, process features, environments, and fetch
  adapters were fixed at launch. The required repeated-mechanism retrospective
  was recorded before source remediation and kept the correction at the
  existing provider-attempt boundary.
- The correction suppresses the existing live provider steering controller
  only while the trusted completion-native restriction is current. A foreground
  input present before provider launch still clears the scope and receives the
  ordinary route; input arriving after restricted launch remains with the
  existing admission/mailbox owner for the following unrestricted turn. No new
  queue, state owner, authority profile, lifecycle, or compatibility path was
  added.
- Current `main` was then merged with two bounded changelog conflicts. The
  resolution mechanically preserves this PR's generated-group-photo entry and
  current main's Starter, patterns, reminders, workout-card, and managed
  web-search items. The focused changelog/design set passes 53 tests and the
  full Web typecheck passes.
- The restricted-attempt regression failed before the one-boundary correction,
  then passed with no live steering controller on the completion attempt and
  the original controller restored on the later ordinary invocation. Six
  affected Assistant Engine files pass 419 tests; the Assistant Engine
  typecheck and 58 runner bundle-policy tests pass. Fresh full assembly passes
  at an 8,691,916-byte Vault CLI total, 1,599,516-byte runner entry,
  7,732,478-byte static boot closure, and 9,624,146-byte runner total without a
  ratchet change. Docs drift, whitespace, and candidate identifier/secret scans
  pass.
- A later conflict-free merge reconciled main's Mobvoi/Health Connect lane and
  is base-only relative to this PR's current patch. The PR body now explicitly
  distinguishes the persisted Durable Object runner schema floor from the
  absence of a SQL/application-database migration and the round-12 review
  package declares all four existing rendered changelog screenshots. Round 12
  must review the fresh pushed full patch while exact-head CI runs concurrently.
- Valid substantive round 12 reviewed exact pushed head `0da0e52b6bcf` with
  ReviewGPT 0.5.124. The wrapper verified requested `gpt-5.6-sol`, response
  `gpt-5-6-pro`, and response SHA-256
  `7318e2e8e82c086ed7544c3e9283a19d99602889ab98c3bf77d0b0b9aecf6254`.
  Its one accepted review-induced finding showed that direct `image_ref`
  avatar reuse passed the visible-first guard while the sibling generated-
  avatar route could consume unseen generated `referenceImageRefs` before
  generation, private publication, and group mutation.
- The required repeated-mechanism retrospective was recorded before source
  remediation. The correction keeps the existing pre-publication group-tool
  owner and delivery verifier: it derives candidate refs from either avatar
  mode, deduplicates `raw/captures/**` refs, and rejects the complete operation
  if any existing verifier result is false. No new queue, verifier, state owner,
  authority source, lifecycle, database, or compatibility path was added.
- The production-shaped regression first failed because the request reached
  image generation instead of returning the visible-first result. It now proves
  that an unseen generated ref blocks the image provider, private publisher,
  and group mutation; a mixed set fails closed; accepted physical delivery
  enables the same generated reference; and an ordinary capture remains
  eligible. The full group-tool file passes 100 tests, and five adjacent
  generation/authority files pass 149 tests. Assistant Engine typecheck and 58
  runner bundle-policy tests pass. Fresh full assembly passes at an
  8,693,269-byte Vault CLI total, 1,599,840-byte runner entry,
  7,734,484-byte static boot closure, and 9,626,336-byte runner total without a
  ratchet change. Round 13 must review the fresh pushed full patch while
  exact-head CI runs concurrently.
- Current `main` then advanced across seven merged lanes. The ordinary merge
  had five textual conflicts. Runner entrypoint policy keeps main's latest
  measured baseline and ratchets only its total to the exact combined graph;
  the focused policy file retains that same value. The changelog resolution
  preserves generated group photos and main's selected-voice entry in both
  production copy and page proof. The generated CLI skill hash was regenerated
  from the merged built command tree rather than choosing either side.
- The first exact combined assembly deliberately failed because the latest
  main budget was 6,189 bytes below the measured 9,675,965-byte graph. After
  ratcheting to that exact measurement plus the existing fixed allowance, 58
  runner bundle-policy tests and fresh full assembly pass at an 8,716,121-byte
  Vault CLI total, 1,599,840-byte runner entry, 7,753,694-byte static boot
  closure, and 9,675,965-byte runner total. The two CLI skill-hash tests and
  exact package-shape verification pass. On the settled merge, five adjacent
  Assistant Engine files pass 149 tests, the changelog/design set passes 54
  tests, and both Assistant Engine and Web typechecks pass. Round 13 must review
  the final pushed merged head while its exact-head CI runs concurrently.
- Valid substantive round 13 reviewed exact pushed head `3fdf0b6cedda` with
  ReviewGPT 0.5.124. The wrapper verified requested `gpt-5.6-sol`, response
  `gpt-5-6-pro`, and response SHA-256
  `683e8fc5f7f653f81715ab31d4a03aab1c14e1d24e08b8bf9a234f70ab77b4d0`.
  Its one accepted original-PR finding showed that vault-wide count pruning can
  delete otherwise recent generated-image delivery evidence after 100 newer
  terminal intents even though the generated capture remains live for 14 days.
- The required repeated-mechanism retrospective was recorded before source
  remediation. The correction stays in the existing outbox pruning owner and
  derives the narrow exception from existing singleton `gpt-image-2`
  `vault_image` media under `raw/captures/**`. Such evidence is excluded only
  from count eviction and retains the existing 14-day age cutoff. Ordinary
  terminal intents remain capped at 100; transcript, provider continuity, and
  capture lookup remain provenance only. No state, lookup, queue, lifecycle,
  database, delivery owner, or alternate authority source was added.
- The real pruning regression proves accepted generated delivery survives more
  than 100 newer ordinary terminal intents, ordinary inventory remains capped,
  and the generated evidence expires after the age cutoff. It passes with the
  full outbox, response-media, and group-tool set: 199 tests. Assistant Engine
  typecheck and 58 runner bundle-policy tests pass. Fresh full assembly passes
  at an 8,716,582-byte Vault CLI total, 1,599,840-byte runner entry,
  7,754,155-byte static boot closure, and 9,676,426-byte runner total without a
  ratchet change. Round 14 must review the fresh pushed full patch while exact-
  head CI runs concurrently.
- Valid substantive round 14 reviewed exact pushed head `99ff781624e8` with
  ReviewGPT 0.5.124. The wrapper verified requested `gpt-5.6-sol`, response
  `gpt-5-6-pro`, and response SHA-256
  `cd6c6394825da7d205e1e3dd8b29f372955c7692ddcc9f59904dbc3c8004ddcf`.
  It returned `ROUND_OUTCOME: PASS` with no qualifying correctness, privacy,
  security, reliability, architecture, purpose, or product-experience finding.
  Parent triage accepted zero findings. The PR change-shape table now separates
  the generated CLI hash correctly, and the design-proof note truthfully says
  the current desktop/mobile study captures are linked rather than packaged;
  parent visual inspection found both current studies readable at their target
  widths. Exact-head required CI on the reviewed head was green.
- After the pass, current `main` advanced and made the PR non-mergeable. One
  normal base update resolved four bounded conflicts under the documented
  behavior-preserving exception. Runner policy and its test select current
  main's newer, higher total ceiling while preserving the reviewed entry/static
  baselines and fixed allowances. Changelog production copy and page proof
  mechanically retain this PR's generated-photo entry plus current main's
  private continuation, lighter-page, and clearer-report content within the
  existing title and summary schema limits. No reviewed runtime behavior,
  configuration contract, or authority boundary changed, so ReviewGPT was not
  rerun solely for the base update.
- On final merged head `7713d647a2`, the runner-policy file passes 42 tests,
  the outbox/response-media/group-tool set passes 199 tests, and the changelog
  pair passes 40 tests. Cloudflare, Assistant Engine, and Web typechecks pass.
  Fresh full runner assembly passes with an 8,716,103-byte Vault CLI total,
  1,619,381-byte runner entry, 7,778,735-byte static closure, and 9,707,670-byte
  total against the retained 9,711,424-byte ceiling. `git diff --check` passes,
  the worktree is clean, and `git merge-tree --write-tree HEAD origin/main`
  succeeds. Required exact-head CI remains the final remote ready-state gate.
Completed: 2026-08-11
