# Collapse current-sender personal runtime requests into one tool

Status: completed
Created: 2026-08-11
Updated: 2026-08-13

## Goal

- Let Group Murph infer the answer audience from ordinary conversation while
  keeping the exact accepted group input as the only sender/source authority.
  If the answer audience is genuinely ambiguous, ask one natural clarification
  without prescribing how the member must reply. Tell the room before any
  group-bound personal read is admitted.
- Prevent stale conversational context from changing the destination of a fresh
  group request while preserving the existing privacy and route-binding gates.

## Success criteria

- The model-facing group tool exposes internal intent actions that each accept
  only one exact message ref; members never need to use a command form.
- One shared Web admission path validates the exact accepted message, sender,
  and route before dispatch, with one origin-level request identity.
- Ambiguity is held by one short-lived exact-source pointer per group/sender,
  and only that same sender's later natural answer can resume it.
- Group-return and direct-recipient completions remain target-bound and cannot
  cross recipients or routes.
- Focused tests cover both destinations and a fresh non-private request following
  older private-continuation context.
- Required typechecks, ReviewGPT specialist/final gates, exact-head CI, and
  current-base merge-tree proof pass on the opened PR.

## Scope

- In scope: assistant tool schema/parser/execution, hosted execution contracts,
  Web group-tool admission and completion routing, runtime answer-mode mapping,
  focused tests, durable owner docs, and a public-safe changelog fragment.
- Out of scope: a rule-based language parser, a second classifier/provider
  turn, group membership semantics, unrelated assistant tools, and frontend UI.

## Constraints

- Technical constraints: deletion-first architecture; one authority resolver;
  no model-supplied sender or route; no new service or classifier provider
  turn; store no copied question text; preserve deployed-runtime skew safety.
- Product/process constraints: confidential incident evidence must not enter the
  repository or PR; use synthetic tests; obtain a ReviewGPT implementation patch
  as advisory input; run the mandatory preliminary and final PR review gates.

## Risks and mitigations

1. Risk: collapsing the surface accidentally broadens private delivery.
   Mitigation: make the fresh exact question Web's sole audience evidence,
   require explicit private wording for direct delivery, and reuse the existing
   sender/route authority; the reviewer may only allow or deny.
2. Risk: Web, hosted contracts, and warm runtime bundles deploy out of sync.
   Mitigation: prefer a backward-compatible consumer-first transition or record
   an explicit tandem deployment requirement with direct parser tests.
3. Risk: deletion leaves stale action names or target variants in prompts/docs.
   Mitigation: run repository-wide stale-symbol searches plus focused contract,
   tool, Web, and runtime tests.

## Tasks

1. Ask ReviewGPT Pro for a scoped deletion-first implementation patch and inspect
   its assumptions before applying any hunk.
2. Trace and collapse Web phrase classification into exact-ref internal intent
   actions, same-sender clarification continuation, and one fixed audience
   before the existing final reviewer.
3. Add focused regression coverage and update the live architecture/security/
   reliability contracts plus member-visible changelog.
4. Run focused tests, typechecks, static stale-symbol checks, and direct scenario
   proof; inspect the complete candidate diff.
5. Commit/push, open the PR, run preliminary specialist and final ReviewGPT gates
   concurrently with CI, remediate findings, finalize the plan, and prove a clean
   current-base merge.

## Decisions

- Use the existing exact accepted-message reference as the only sender, route,
  and audience-evidence source. The consolidation must not introduce a second
  intent classifier or provider turn.
- Treat the ReviewGPT patch as untrusted design input: inspect it fully and adapt
  only the smallest maintainable change that preserves repository invariants.
- Keep member-facing conversation natural. Internal actions express the inferred
  group/private/clarify/continue decision using only an exact ref; Web derives
  sender and route and prevents audience changes on replay. The existing
  outgoing reviewer can only allow or deny that fixed disclosure.
- Retain the two old wire spellings only as a bounded rolling-deploy seam. The
  parser immediately canonicalizes them, while in-process ownership uses one
  canonical request shape. Lock canonical and legacy
  request aliases together so one origin can admit only one personal read.

## Progress

- ReviewGPT Pro supplied a deletion-first advisory patch. Every hunk was
  inspected before application, and the final prompt retained the existing
  unrelated group-tool safeguards.
- The assistant tool catalog, strict hosted contract, Web admission owner, warm
  runtime mapping, and Cloudflare port now use one canonical current-sender
  action, but ReviewGPT's first final audit proved that its required destination
  still left terminal audience authority model-owned and origin admission split.
- ReviewGPT Pro returned a second complete patch that removes the model-authored
  destination, establishes one origin-level request identity, reuses the
  existing fresh outgoing reviewer only for allow/deny, serializes the deployed
  rollout aliases, and fails mixed-version traffic closed.
- Synthetic coverage proves both destinations, exact message/sender/route
  authority, rollback wire compatibility, and the stale-context regression.
- Focused suites pass across hosted execution, assistant engine, assistant
  runtime, Web, Cloudflare, and PostgreSQL-backed admission; affected package
  typechecks pass.
- PR #1705 is open. The first exact-head final audit found and proved three
  defects: private completion could block terminal fallback, common private
  reply phrasing could default to the group, and undeployed compatibility had
  been retained. The remediation separates private delivery from group fallback,
  makes unfamiliar audience wording fail closed, persists a fresh group
  fallback after expiry or provider-entry route loss, and deletes those
  compatibility paths.
- ReviewGPT round four found three further concrete gaps. The exact-source
  classifier now recognizes common confidentiality clauses without treating
  substantive privacy words as delivery instructions; expired retries recover
  an exact retained group terminal instead of colliding with it; the detached
  queue regression proves that replay releases the following ask; and the stale
  runtime expiry integration now exercises the live Web-persisted fallback
  handshake.
- ReviewGPT round five found that several explicit confidentiality clauses
  could still default to the group and that a completion committed near the
  request deadline could expire before the destination runtime imported it.
  Web now parses a bounded terminal audience clause, rejects unsupported
  audience language, preserves substantive phrases such as private insurance,
  and gives new group/private terminal envelopes a fresh bounded import window
  without extending the original private-send authority. Focused Web,
  typecheck, and four-case PostgreSQL proof pass.
- ReviewGPT round six found the bounded parser only inspected trailing audience
  clauses. The same owner now extracts one recognized leading clause before
  inspecting the trailing edge, rejects leading/trailing conflicts, and keeps
  substantive privacy words out of audience authority.
- ReviewGPT round seven found that explicit one-to-one and plural-DM directions
  still escaped the edge grammar. The bounded grammar now recognizes those
  private forms and rejects separated or leading delivery directives it cannot
  map exactly. The hard seven-round cap is reached; after this fix the loop is
  paused pending the required cap retrospective and explicit continuation
  decision. The PR is not merge-ready without a later ReviewGPT pass.
- Hard-cap retrospective: the original requirement remains one exact-source
  personal read whose sender and audience are fixed by Web authority before
  model work, with every accepted request converging to one
  visible terminal. The immutable first-reviewed head carried 460 added/433
  deleted source lines, 697/317 test lines, and 232/76 docs lines; the current
  head carries 1,997/801 source, 2,023/1,722 tests, and 552/175 docs. Most growth
  came from review-driven removal of model audience authority, deployed-only
  compatibility fencing, distinct private/group completion identities, expiry
  and provider-entry convergence, retained-terminal replay, and the edge
  audience grammar. The repeated round-5 through round-7 mechanism was a
  phrase-enumeration approach that could still default explicit privacy intent
  to the group. The current correction closes that mechanism at the grammar
  boundary: known one-to-one/DM clauses map private, while bounded separated or
  leading delivery directives that are not recognized exactly reject. It adds
  no model turn, service, schema, queue, state owner, reconciliation path, or
  compatibility surface. Deleting or reverting would restore the original
  model-owned privacy boundary; splitting would separate an indivisible
  admission/completion invariant. The user then identified that newest-only
  binding drops an earlier valid request from a mixed-sender turn. The bounded
  correction restores one opaque `message_ref` argument while keeping sender,
  question, audience, route, and personal-read authority in Web. Runtime accepts
  only refs from the current accepted group turn, and Web independently reloads
  and validates every selected source, so two valid requests can each proceed
  without reviving model-owned identity or audience authority. The user
  explicitly authorized this correction, one sensitive full-snapshot round 8,
  and shipping on 2026-08-12.
- Remaining work is focused proof, the exact-head final ReviewGPT round, CI,
  plan closure, and merge-tree proof.
- The exact-message correction passes the focused Assistant Engine schema and
  execution suites (91 tests), the focused Web admission suite (19 tests), and
  the affected Assistant Engine and prepared Web typechecks. The Web proof
  admits two independent flat requests from one mixed-sender batch and keeps
  their canonical request/member identities distinct.
- Complete first-provider request capture used the pinned real Codex App
  Server, local scripted Responses provider, `gpt-5.6-terra`, low reasoning,
  production code mode, synthetic direct/group turns with the group tool
  available, and `gpt-tokenizer` 3.4.0 `o200k_harmony`. It serialized and
  normalized `include`, `input`, `instructions`, `parallel_tool_calls`, `text`,
  `tool_choice`, and `tools`, excluding model selection, reasoning, storage,
  streaming, service-tier, account, cache, and transport metadata identically.
  The deferred group description and schema are absent from the complete first
  request, so base and head are identical: direct 111,567 bytes / 24,330 tokens;
  group 95,823 bytes / 20,745 tokens. The temporary capture hook was removed
  and verified absent.
- Authorized full-snapshot ReviewGPT round 8 accepted the exact-ref correction
  but found that round 7 had removed the broader fail-closed signal check for a
  separated subject-led confidentiality clause. The production path proved
  that clause could default to the group. The correction
  restores the bounded audience-signal guard only at separated edges, retains
  exact one-to-one/DM mappings, ignores empty terminal separators, and adds no
  owner or lifecycle. Focused classifier/admission proof now rejects three
  subject-led private forms before route resolution or mailbox append while the
  22-test Web authority suite remains green.
- Exact-head CI on `12634c58ab99` passed before the round-8 correction. The
  corrected head still requires its own CI and the follow-up ReviewGPT PASS.
- Full-snapshot ReviewGPT round 9 accepted the round-8 correction and verified
  every earlier authority, replay, expiry, and terminal mechanism, but found the
  same fail-open class in a single unseparated complement: delivery-to-audience
  wording or a terminal confidentiality modifier could still reach the group
  default. The existing no-separator guard now rejects a bounded delivery verb
  followed by a recipient/audience or a terminal confidentiality directive. It
  does not treat substantive wording such as `private insurance` as delivery
  intent. Five classifier and Web-admission cases prove zero route resolution,
  request append, or wake; the focused Web authority suite passes 27 tests. This
  is a predicate correction inside the existing Web owner, not another parser
  owner, model turn, state, queue, service, or phrase-selected destination.
- Full-snapshot ReviewGPT round 10 found that the round-9 regex still defaulted
  several ordinary private endings to the group and falsely rejected ordinary
  questions containing delivery-looking verbs. The finding was accepted; no
  additional phrase was added. The user rejected exact-form UX and explicitly
  chose a requirement-level redesign on 2026-08-13: Murph infers natural
  audience intent, clarifies genuine ambiguity conversationally, and gives the
  room advance notice before a group-bound answer.
- The redesign deletes the Web phrase parser. Internal model actions still take
  only the exact accepted message ref. Web reloads that source and derives its
  authenticated sender and route. One short-lived group/sender clarification
  pointer retains only exact input/session/order metadata, never copied question
  text; continuation resolves only from the same sender and is replay-safe.
  A deterministic system notice must be delivered before Web receives any
  group-bound request. Private and clarification paths send no group notice.
  Hourly bounded retention and account deletion own the pointer lifecycle.
- The new architecture adds one narrowly demonstrated persisted owner for
  natural clarification, while deleting the repeated phrase grammar that drove
  rounds 3 through 10. It adds no service, queue, timer, manager, dependency, or
  classifier turn.
- Final local proof after the causal-order simplification passes: 307 focused
  Web behavior/privacy/retention assertions; 110 Assistant Engine assertions;
  34 Assistant Runtime assertions; 6 Hosted Execution assertions; 9 Cloudflare
  port assertions; 57 changelog assertions; 5 opt-in PostgreSQL cases; Web,
  Cloudflare, and the three affected package typechecks; Prisma validation and
  generation; Web lint with zero errors; docs drift; stale-symbol, diff, and
  private-identifier scans. The PostgreSQL lane proves four concurrent natural
  continuations converge on one exact original request.

## Verification

- Commands to run: focused Vitest suites for assistant-engine, Web group-tool,
  hosted current-sender asks, assistant-runtime, and Cloudflare contract ports;
  affected package typechecks; `git diff --check`; stale-symbol searches;
  exact-head GitHub Actions; ReviewGPT specialist/final presets; `git merge-tree`.
- Expected outcomes: Murph understands ordinary audience intent, asks naturally
  when it cannot tell, announces group sharing before personal access, binds
  concurrent speakers by their exact refs, keeps Web identity/route authority,
  and passes the new full-snapshot ReviewGPT gate and exact-head CI.
Completed: 2026-08-13
