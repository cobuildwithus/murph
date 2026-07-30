# Resume PR 1122 on the Linq health foundation

Status: active
Created: 2026-07-30
Updated: 2026-07-30

## Goal

- Preserve PR 1122's hard-blocked group-recovery experience while rebasing it
  onto the provider-health ownership and typed egress policy merged by PR 1118.
- Remove the recovery branch's duplicate generic provider-status classifier and
  keep final admission, sender selection, and retry authority inside the
  existing routing, line-capacity, delivery, and transport owners.

## Success criteria

- The branch contains current `main` and merges cleanly.
- Exact assigned at-risk groups continue through the canonical group route.
- Exact assigned hard-blocked groups send at most the bounded, stable,
  member-private recovery instruction from an authorized backup line.
- Recovery consumes PR 1118's independent provider state and typed egress
  policy rather than duplicating generic severity or ranking logic.
- Focused routing, delivery, receipt-ordering, capacity, PostgreSQL, typecheck,
  lint, and direct scenario proof pass.
- Required product review, parent final review, exact-head CI, and the explicitly
  authorized next ReviewGPT round have no unresolved accepted findings.

## Scope

- In scope:
  - merge current `main` into `agent/critical-group-backup-recovery`
  - resolve the PR 1118 overlap in Web Linq routing, line-store, delivery, and
    their focused tests and durable messaging documentation
  - update PR 1122's intent, architecture, verification, and review history
- Out of scope:
  - changing PR 1118's provider-health ownership or reconciliation lifecycle
  - absorbing PR 1111's recent-message-load selector
  - adding schemas, queues, cron jobs, managers, or route-transfer state
  - frontend work or automatic group participant mutation

## Constraints

- Technical constraints:
  - preserve one canonical Linq route/account owner and one delivery owner
  - revalidate live member, assignment, incoming-line, sender, and receipt
    authority immediately before provider entry
  - preserve one pinned sender, rendered number, message body, and original
    capacity reservation across bounded failed-receipt advancement
  - keep raw contacts, group ids, provider prose, and credentials out of
    durable diagnostics and review artifacts
- Product/process constraints:
  - preserve the link-free instruction to add the displayed backup number in
    the existing group before retrying
  - follow the PR-lane completion workflow; broad verification belongs to
    exact-head CI
  - retain the task worktree while the PR remains open

## Risks and mitigations

1. Risk: A mechanical merge preserves the deleted generic severity model under
   a renamed helper.
   Mitigation: trace each recovery decision to PR 1118's typed policy owner and
   delete duplicate classification/ranking logic.
2. Risk: Rebase changes sender eligibility for the receipt-correlated retry
   exception.
   Mitigation: keep the exception exact-delivery-correlated, fail closed for
   newer or unrelated provider degradation, and run composed receipt-ordering
   tests plus direct source inspection.
3. Risk: Base integration changes unrelated Linq behavior.
   Mitigation: resolve only task-overlap conflicts, preserve current-main
   ownership, and run focused existing route, line, and transport suites.

## Tasks

1. Fetch current remote state and inspect the exact PR 1118 interfaces and
   overlap against PR 1122.
2. Merge current `main`, resolve conflicts, and delete duplicate status logic.
3. Update focused tests and current durable messaging documentation.
4. Run focused proof, required product review, and parent final review.
5. Close this plan through `scripts/finish-task`, push the exact head, update
   the PR description, run the approved next ReviewGPT round concurrently with
   CI, and prove mergeability.

## Decisions

- Continue PR 1122 rather than supersede it. PR 1118 owns provider-health facts
  and typed egress policy; PR 1122 owns only the hard-blocked group-recovery
  experience.
- Use a normal merge from `origin/main` so the already reviewed recovery
  history remains visible and no force push is required.
- Preserve the pre-existing inbound distinction on top of the typed policy:
  `AT_RISK` reputation may continue the exact assigned member-initiated group,
  hard provider or delivery blocks trigger private recovery, and ordinary
  warning/degraded delivery state remains unavailable for new route creation.
- Treat the exact receipt-correlated warning as the only retry exception. The
  typed new-conversation policy still blocks independent service, reputation,
  operator, and unrelated delivery-health failures.

## Verification

- Passed:
  - seven focused Vitest files: 313 tests
  - isolated PostgreSQL recovery/concurrency proof: 16 tests
  - `pnpm --dir apps/web typecheck`
  - scoped ESLint over all changed Web source and tests
  - `git diff --check`
- Pending:
  - parent final review
  - exact-head required GitHub Actions
  - final ReviewGPT round 6
  - final mergeability proof against current `main`
