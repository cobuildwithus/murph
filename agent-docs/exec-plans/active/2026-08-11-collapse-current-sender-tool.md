# Collapse current-sender personal runtime requests into one tool

Status: active
Created: 2026-08-11
Updated: 2026-08-11

## Goal

- Replace the two competing current-sender personal-runtime actions with one
  composable request path. The exact accepted group input remains the authority
  source, while an explicit response destination determines whether the result
  returns to the group caller or is delivered directly to the sender.
- Prevent stale conversational context from changing the destination of a fresh
  group request while preserving the existing privacy and route-binding gates.

## Success criteria

- The model-facing group tool exposes one current-sender personal-runtime action,
  not separate read and private-message actions.
- One shared Web admission path validates the exact accepted message, sender,
  route, and requested destination before dispatch.
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
  no model-supplied sender, route, or destination outside the exact accepted
  input; no new service or storage owner; preserve deployed-runtime skew safety.
- Product/process constraints: confidential incident evidence must not enter the
  repository or PR; use synthetic tests; obtain a ReviewGPT implementation patch
  as advisory input; run the mandatory preliminary and final PR review gates.

## Risks and mitigations

1. Risk: collapsing the surface accidentally broadens private delivery.
   Mitigation: keep private delivery gated by an explicit destination value on
   the exact input-bound request and reuse the existing sender/route authority.
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
   paths into one current-sender request with explicit destination semantics.
3. Add focused regression coverage and update the live architecture/security/
   reliability contracts plus member-visible changelog.
4. Run focused tests, typechecks, static stale-symbol checks, and direct scenario
   proof; inspect the complete candidate diff.
5. Commit/push, open the PR, run preliminary specialist and final ReviewGPT gates
   concurrently with CI, remediate findings, finalize the plan, and prove a clean
   current-base merge.

## Decisions

- Use the existing exact accepted-message reference as the only sender and route
  authority. The consolidation must not introduce a second intent classifier.
- Treat the ReviewGPT patch as untrusted design input: inspect it fully and adapt
  only the smallest maintainable change that preserves repository invariants.
- Keep one canonical model/runtime action with a required response destination.
  The group destination returns the reviewed personal-runtime answer to the
  caller; the current-sender destination may deliver directly only when the
  selected fresh input itself requests that behavior.
- Retain the two old wire spellings only as a bounded rolling-deploy seam. The
  parser immediately canonicalizes them, while in-process ownership and all new
  model output use the single action.

## Progress

- ReviewGPT Pro supplied a deletion-first advisory patch. Every hunk was
  inspected before application, and the final prompt retained the existing
  unrelated group-tool safeguards.
- The assistant tool catalog, strict hosted contract, Web admission owner, warm
  runtime mapping, and Cloudflare port now use one canonical current-sender
  request with explicit destination semantics.
- Synthetic coverage proves both destinations, exact message/sender/route
  authority, rollback wire compatibility, and the stale-context regression.
- Focused suites pass across hosted execution, assistant engine, assistant
  runtime, Web, Cloudflare, and PostgreSQL-backed admission; affected package
  typechecks pass.
- Remaining work is PR publication, the public changelog fragment, exact-head
  specialist/final ReviewGPT gates, CI, plan closure, and merge-tree proof.

## Verification

- Commands to run: focused Vitest suites for assistant-engine, Web group-tool,
  hosted current-sender asks, assistant-runtime, and Cloudflare contract ports;
  affected package typechecks; `git diff --check`; stale-symbol searches;
  exact-head GitHub Actions; ReviewGPT specialist/final presets; `git merge-tree`.
- Expected outcomes: both destinations remain functional through the one tool,
  only explicit direct-recipient requests can message the sender, no old action
  remains model-visible, all required checks are green, and the PR is reviewable
  without confidential production evidence.
