# Finish same-owner device wake convergence

Status: completed
Created: 2026-08-31
Updated: 2026-08-31

## Goal

- Finish PR #2581 with one priority-preserving runtime-wake classification
  contract so an active `system_mailbox` pass absorbs same-owner rechecks but
  still yields to default or unclassified foreground work.

## Success criteria

- Same-owner wakes arriving before readiness, during initial fetch, and after
  import do not prevent the retained device item from reaching its existing
  provider, checkpoint, acknowledgement, and handled-through path.
- Any coalesced notification set containing default, unclassified, or another
  processing mode remains preempting even if a later notification is
  `system_mailbox`.
- The two existing aggregation owners use the same monotonic priority rule and
  no new state owner, queue, retry loop, or scheduler is introduced.
- One composed controller-to-container-to-runtime regression proves
  default-then-system ordering yields before device work.
- Focused runtime and Cloudflare suites, package typechecks, exact-head CI, and
  final ReviewGPT pass.
- The exact candidate passes ReviewGPT and required CI, then PR #2581 merges.
- Deployment remains a separately authorized protected operation with bounded
  postdeploy aggregates documented at handoff.

## Scope

- In scope: PR #2581's existing Cloudflare active-owner wake, container
  coalescing signal, system-mailbox preemption view, focused regressions, and
  exact-head review, CI, and merge gates.
- Out of scope: Temporal retry policy, provider scheduling policy, manual
  production progress mutation, schemas, deployment, and the separate Linq
  canary checkpoint conflict.

## Constraints

- Technical constraints: foreground priority is monotonic; an aggregate is
  same-owner only when every observed notification is explicitly
  `system_mailbox`. Preserve existing durable mailbox and checkpoint owners.
- Product/process constraints: smallest maintainable correction, no dropped
  work, no new abstraction beyond the already reviewed filtered signal, and no
  production-data repair.

## Risks and mitigations

1. Risk: a later same-owner wake could overwrite an earlier foreground wake.
   Mitigation: both aggregators keep the higher-priority classification once
   observed; mixed-mode regression coverage proves the order.
2. Risk: treating an unclassified wake as same-owner could starve a reply.
   Mitigation: only exact `system_mailbox` is absorbable; null and every other
   mode remain preempting.
3. Risk: absorbing all wakes could hide liveness replacement.
   Mitigation: retain the existing controller command deadline, liveness read,
   and replacement path; only the active child's notification classification
   changes.

## Tasks

1. Completed: re-established exclusive ownership, refreshed the draft against
   current `origin/main`, and preserved the only merge conflict as a union of
   changelog provenance.
2. Completed: added the failing mixed-mode aggregation and composed
   default-then-system regression required by final ReviewGPT round 3.
3. Completed: implemented the same minimal monotonic priority merge in both
   existing notification aggregation owners.
4. Completed: ran focused tests, typechecks, diff/privacy checks, and parent
   architecture review.
5. Push the exact candidate, complete final ReviewGPT round 4 and required CI,
   then merge PR #2581.

## Decisions

- Resume the existing reviewed PR rather than create a competing fix.
- Preserve its filtered system-mailbox signal as the single lifecycle-wide
  classification view; remove no retry or durable work owner.
- Resolve the final finding by making existing aggregators monotonic, not by
  adding another queue, manager, or state machine.

## Product UX

- Effort: Patch.
- Affected person: an existing member whose retained wearable work is repeatedly
  re-admitted while the active pass mistakes its own recheck for foreground
  work.
- Expected experience: retained device work completes while a real reply or
  default wake still interrupts it immediately.
- Recovery: existing mailbox persistence, checkpoint CAS, controller liveness,
  and runtime replacement behavior remain unchanged.

## Verification

- Reproduce the mixed-mode bug with focused signal-owner and composed tests.
- Run the focused assistant-runtime system-mailbox/preemption files and
  Cloudflare controller suite plus both package typechecks.
- Run `git diff --check`, changelog proof, PR evidence preflight, exact-head CI,
  and final ReviewGPT round 4.
- At deployment handoff, require equal bounded postdeploy windows for no-op
  `system_mailbox` invocations, device-pass completion, errors, and Vercel
  reconciliation-facts request volume.
Completed: 2026-08-31
