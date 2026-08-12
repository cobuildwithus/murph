# Collapse current-sender personal runtime requests into one tool

Status: active
Created: 2026-08-11
Updated: 2026-08-11

## Goal

- Replace the two competing current-sender personal-runtime actions with one
  composable, destination-free request path. The exact accepted group input
  remains the authority source, while the personal runtime's existing fresh
  outgoing reviewer determines whether the result returns to the group caller
  or is delivered directly to the sender.
- Prevent stale conversational context from changing the destination of a fresh
  group request while preserving the existing privacy and route-binding gates.

## Success criteria

- The model-facing group tool exposes one current-sender personal-runtime action,
  not separate read and private-message actions.
- One shared Web admission path validates the exact accepted message, sender,
  and route before dispatch, with one origin-level request identity.
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
- Out of scope: new persisted state, a new classifier/provider turn, group
  membership semantics, unrelated assistant tools, and frontend UI.

## Constraints

- Technical constraints: deletion-first architecture; one authority resolver;
  no model-supplied sender, route, or destination; no new service, classifier,
  provider turn, or storage owner; preserve deployed-runtime skew safety.
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
2. Trace and collapse the model, Web authority, hosted contract, and runtime
   paths into one destination-free current-sender request whose exact source
   deterministically fixes the audience before the existing final reviewer.
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
- Keep one canonical model/runtime action with no response destination. Web
  deterministically fixes private delivery only from the exact selected
  message; otherwise a valid request returns read-only to the group caller. The
  existing outgoing reviewer can only allow or deny that fixed disclosure.
- Retain the two old wire spellings only as a bounded rolling-deploy seam. The
  parser immediately canonicalizes them, while in-process ownership and all new
  model output use the single destination-free action. Lock canonical and legacy
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
- Hard-cap retrospective: the original requirement remains one argument-free
  personal read whose sender and audience are fixed by exact-source Web
  authority before model work, with every accepted request converging to one
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
  admission/completion invariant. The recommended explicit continuation is one
  full-snapshot round 8 after exact-head CI, solely to obtain the required PASS
  on the corrected architecture.
- Remaining work is the new exact-head final ReviewGPT round, CI, plan closure,
  and merge-tree proof.

## Verification

- Commands to run: focused Vitest suites for assistant-engine, Web group-tool,
  hosted current-sender asks, assistant-runtime, and Cloudflare contract ports;
  affected package typechecks; `git diff --check`; stale-symbol searches;
  exact-head GitHub Actions; ReviewGPT specialist/final presets; `git merge-tree`.
- Expected outcomes: both terminal audiences remain functional through the one
  destination-free tool, only explicit private/direct wording can message the
  sender, ordinary requests return read-only to the group, no old action remains
  model-visible, all required checks are green, and the PR is reviewable without
  confidential production evidence.
