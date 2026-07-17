# Onboarding anchor and warm Codex runtime repair

Status: completed
Created: 2026-07-16
Updated: 2026-07-16

## Goal

- Make the first health topic an onboarding anchor rather than an unsolicited
  plan trigger, restore proactive nonblocking supplement and lab delegation,
  and keep one Codex App Server warm for the lifetime of a warm hosted
  container without weakening invocation-scoped route or device authority.

## Success criteria

- Murph briefly learns and parks one or two meaningful health outcomes,
  completes the broader health foundation conversationally, returns with the
  new context, obtains consent before choosing a thread, and collaborates on
  the first habit or experiment instead of prescribing one unasked.
- Supplement-label and uploaded-lab ingestion can continue in native background
  children after the user-visible reply, while ordinary onboarding answers do
  not block that reply on canonical writes.
- One resident Codex App Server survives sequential ordinary hosted turns even
  when invocation authority changes. Starting a later turn does not kill
  admitted descendant work solely because the root turn ended.
- Invocation-scoped current-route and device authority is not inherited as
  ambient process authority by the resident App Server or foreign children;
  stale work cannot reuse a later invocation's authority.
- The durable invariant, architecture, owner docs, focused tests, required
  audits, exact-head ReviewGPT result, and PR CI all agree.

## Scope

- In scope: onboarding product spec/skills/prompt/tests; hosted Codex process
  identity; deletion of the hosted CLI bridge; typed current-route and device
  authority tools; focused runtime tests; invariant and architecture docs; a
  scoped PR and its ReviewGPT loop.
- Out of scope: domain-specific sleep policy, a new background-job system,
  custom subagent lifecycle supervision, unrelated CLI commands, and unrelated
  hosted runner lifecycle work.

## Constraints

- Preserve native Codex thread/subagent ownership and use the existing narrow
  typed root-tool ports rather than keeping root turns open or adding lifecycle
  state.
- Do not merely remove rotating values from the launch-key hash while leaving
  stale credentials in immutable child process environment.
- Keep canonical vault writes on their current owners and keep user-visible or
  irreversible actions in the parent/root path.
- Preserve unrelated working-tree and coordination-ledger changes.

## Proven cause

- The July 13–14 per-invocation current-route grant and CLI bridge bearer were
  added to the Codex child environment. The existing launch identity hashes
  that environment, so every later ordinary provider invocation replaces the
  resident App Server.
- Before those changes, hosted multi-agent tests intentionally kept one App
  Server across parent completion, descendant notifications, and the next root
  turn.
- A running thread in the pinned Codex version ignores changed
  `thread/resume` configuration, so resume-time environment overrides cannot
  safely carry new invocation authority into the warm root thread.

## Tasks

1. Encode the warm App Server lifetime rule in durable contracts and owner
   docs, then reuse the existing root dynamic-tool context for device and
   automation actions.
2. Delete the hosted CLI bridge, its loopback transport, rotating bearer and
   route grant, per-invocation lifecycle, and post-turn terminal cleanup;
   replace regression tests with positive warm-reuse and stale-authority
   denial proof.
3. Finish the aspiration-first onboarding contract, remove root-turn waiting,
   and restore proactive background supplement/lab ingestion plus the related
   Function Health and voice guidance.
4. Run focused tests, package typechecks, diff/privacy checks, required local
   completion audits, and address evidence-backed findings.
5. Finish the scoped plan commit, reconcile and push the task branch safely,
   open the PR with the required intent/change-shape contract, and run the
   exact-head ReviewGPT loop with CI until both are green.

## Verification plan

- Assistant-engine prompt/skill/model behavior and Codex runtime tests.
- Assistant-runtime tool/config/workspace tests proving changing invocation
  context without App Server replacement and fail-closed stale access.
- Owning package typechecks and diff-aware required repository verification.
- Coverage-write and prompt-review specialist passes, parent simplification and
  privacy review, then the PR-lane ReviewGPT gate instead of local deep review.
- PR CI, exact pushed-head proof, and merge-conflict proof against current main.
Completed: 2026-07-16
