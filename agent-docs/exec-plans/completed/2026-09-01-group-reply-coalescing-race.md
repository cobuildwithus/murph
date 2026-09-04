# Collapse group reply coalescing registration race

Status: completed
Created: 2026-09-01
Updated: 2026-09-02

## Goal

- Restore the existing group-chat promise: rapid exact-successor messages that
  arrive while Murph is forming the first reply are considered by that active
  turn and produce one final reply.
- Remove the notification-registration race without adding another durable or
  process-global state owner.

## Success criteria

- A deterministic regression reproduces an exact late input imported after the
  foreground batch froze but before the active-turn controller could receive
  its notification, and fails on the untouched baseline.
- The existing invocation-local imported-input batch becomes the fallback
  source for the active-turn probe; unrelated pending input and malformed
  background state remain unread.
- The regression passes with one active-turn admission, while causal gaps,
  other conversations, direct-message foreground bounds, and the 50-input cap
  remain unchanged.
- A notified successor whose predecessor notification was missed composes with
  the invocation-local recovered prefix, and a fully missed multi-message
  prefix drains in the same admission rather than one message per provider
  request.
- Exact-conversation and room-route discoveries share one global cursor order,
  so a later same-actor message cannot leapfrog an earlier group participant.
- Focused runtime/engine tests, package typechecks, a production-derived
  synthetic real-Codex group journey, privacy/diff checks, exact-head
  ReviewGPT, and required CI pass.

## Scope

- In scope: invocation-local foreground input refresh, active-turn admission,
  group draft reconsideration, focused runtime/engine tests, current owner docs,
  and one changelog entry for the member-visible reliability improvement.
- Out of scope: provider lifecycle changes, broad pending-index scans, new
  queues/retry loops/schedulers, schema changes, direct-message batching policy,
  Temporal/Cloudflare ownership, and deployment.

## Constraints

- Technical constraints: keep the initial foreground selection frozen for the
  ordinary scanner; only the active-turn conversation query may see exact IDs
  already imported by this invocation. Preserve exact-successor, route,
  projection, authority, causal-gap, replay, and cardinality checks.
- Product/process constraints: classify as a Product UX Patch. Outcome: one
  coherent reply for a rapid group follow-up. Reaches: authenticated Linq and
  Telegram group turns using the existing held-draft path. Proof: deterministic
  missed-notification regression plus a synthetic real-Codex group journey.

## Risks and mitigations

1. Risk: a broad refresh admits old or unrelated pending input.
   Mitigation: derive only from the existing invocation-local imported-input
   batch and retain the current conversation/route/exact-successor filters.
2. Risk: extending the selected batch changes ordinary scanner ordering.
   Mitigation: keep the initial selected candidates immutable and expose late
   imported candidates only through the active-turn conversation query.
3. Risk: duplicate notifications or probes double-admit one input.
   Mitigation: retain existing known-input filtering and source-local observed
   ID dedupe; prove one admission and one final reply.

## Tasks

1. Add the exact missed-notification regression and capture its baseline
   failure before changing production code.
2. Route the existing invocation-local imported input IDs into the hosted input
   source and let foreground refresh expose them only to active-turn queries.
3. Run focused boundary, group-draft, adjacent invariant, typecheck, and
   production-derived real-Codex journey proof.
4. Inspect complexity, privacy, docs/changelog, final diff, and close the plan.
5. Commit, push, open the PR, then run exact-head ReviewGPT concurrently with
   required CI and resolve any accepted findings.
6. Follow up the merged change by proving the store-backed A1-B1-A2 ordering
   gap and removing the strict-first composition path.

## Decisions

- The pending-input index remains the durable retry owner, but this hot-path
  fallback will not compact or scan it. The workspace runner already owns the
  exact invocation-local imported-input batch, so the assistant phase will
  compose that existing read into its active-turn source.
- No pre-controller notification buffer: it would add process-global lifetime,
  cleanup, and stale-turn semantics for a race that existing invocation state
  can derive directly.
- Active-turn admission has one discovery path: refresh the invocation-local
  source, retain its authoritative conversation prefix, add only notified or
  route candidates not already discovered, order once, and accept the complete
  valid prefix within the existing cumulative cap.
- Exact-conversation discovery remains the eligibility authority for its
  results, but those results enter the same sorted selector as notification and
  route discoveries. This preserves compatibility without a second ordering
  path or another frontier.

## Verification

- Baseline proof: the focused missed-notification regression failed before the
  production change because foreground refresh returned `no_new_input`.
- Candidate proof: the same regression passes; the full hosted turn-input suite
  passes 39/39; the workspace-phase handoff test and the held-group single-
  commit test pass; the assistant-runtime package typecheck passes.
- Review regression proof: both the missed-predecessor notification case and a
  fully missed three-message room prefix failed before the admission collapse
  and now pass. A production-faithful store-backed A1-B1-A2 regression then
  failed because A2 was admitted ahead of B1; it passes after globally ordering
  all discovery results. The full assistant auto-reply runtime suite passes
  190/190.
- Real-Codex journey: passed against the production group prompt/tool surface.
  After the admission collapse, the synthetic rapid clarification again
  produced one final response that plainly said the resistance type and level
  were unknown. Product UX verdict: Ready.
- Candidate checks: full assistant auto-reply runtime suite 190/190, hosted
  turn-input suite 39/39, workspace foreground handoff suite 86/86, held-group
  single-commit regression, both package typechecks, complexity guard, and
  privacy/diff checks all pass. The follow-up assistant-engine package suite
  also passes 4,296 tests across 268 files, alongside its package typecheck,
  complexity guard, docs drift, and diff hygiene checks.
- Remaining: exact-head ReviewGPT, required CI, final parent diff review, and
  plan closure.

## Progress

- 2026-09-01: reproduced the registration race at the source boundary, kept the
  failing evidence, and implemented the invocation-local fallback without a
  pending-index scan or a new state owner.
- 2026-09-01: completed focused deterministic tests, typecheck, owner docs, and
  the production-derived real-Codex group journey with a Ready UX result.
- 2026-09-01: resolved the first review finding by making authenticated group
  batching room-scoped across actors and reply anchors.
- 2026-09-01: resolved the second review finding by composing recovered and
  notified inputs at the existing admission owner and draining the bounded
  valid prefix without adding state, a timer, or another queue.
- 2026-09-02: after the original change merged, reproduced a remaining
  strict-first ordering gap against the real store-backed input source and
  collapsed strict, exact, and route discoveries into one ordered selector.
Completed: 2026-09-02
