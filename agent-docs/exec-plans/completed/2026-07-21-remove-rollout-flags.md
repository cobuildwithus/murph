# Remove completed hosted rollout flags

Status: completed
Created: 2026-07-21
Updated: 2026-07-21

## Goal

- Make completed hosted product behavior automatic by deleting four temporary
  rollout gates and the compatibility-only machinery that exists solely to
  support their disabled states.

## Success criteria

- Approval decisions always append the durable approval-outcome wake in the
  decision transaction, and terminal approval pages no longer retain the
  pre-cutover manual confirmation fallback.
- Assistant Ask always admits otherwise-authorized requests without consulting
  an environment switch.
- New group memberships always attempt the existing private join-confirmation
  append, while existing deferred and terminal safety outcomes remain intact.
- Hosted personality writes always use the current sparse-delta causal path,
  and Settings no longer hides personality controls behind a rollout switch.
- Delete rollout-only constants, helpers, disabled result variants, mocks,
  tests, environment examples, activation instructions, and stale current-doc
  references. Preserve immutable completed plans as historical records.
- Preserve real authorization, membership, crypto, delivery, idempotency,
  ordering, rollback-floor, and provider-safety checks.

## Scope

- In scope: live Web and shared-contract source, focused tests, current hosted
  runtime/product/deploy documentation, and stale-reference proof for
  `MURPH_HOSTED_ACTION_APPROVAL_OUTCOME_WAKE_ENABLED`,
  `HOSTED_ASSISTANT_ASK_PRODUCER_ENABLED`,
  `HOSTED_GROUP_JOIN_CONFIRMATION_PRODUCER_ENABLED`, and
  `MURPH_ASSISTANT_PERSONALITY_CAUSAL_WRITES_ENABLED`.
- Out of scope: billing, diagnostic, scheduler, and TLS controls; immutable
  completed plans; deploying the change; deleting environment entries that a
  currently deployed older Web build may still read before this change ships.

## Constraints

- Prefer deletion over replacing gates with constants or permanent shims.
- Preserve product-critical approval continuation, private Assistant Ask,
  group-join confirmation, and personality behavior.
- Preserve unrelated active lanes and work only in the isolated task worktree.
- Do not remove external production environment entries until the deployed Web
  build no longer reads them.

## Risks and mitigations

1. Risk: a still-running old consumer cannot parse work that becomes
   unconditional.
   Mitigation: prove the compatible consumer/runtime floors and document the
   required immediate rollout and post-deploy smoke checks.
2. Risk: deleting a rollout branch also deletes a real safety check.
   Mitigation: remove only environment-controlled branches and their disabled
   compatibility outcomes; retain authorization, identity, route, expiry,
   crypto, and idempotency checks.
3. Risk: unconditional group confirmation increases outbound message volume.
   Mitigation: retain one-per-membership idempotency, private-route resolution,
   deferred delivery, bounded draining, and existing line-health ownership.

## Tasks

1. Map every live rollout-flag read and all compatibility-only callers, tests,
   docs, and result variants.
2. Delete the gates and simplify each call path to the current behavior.
3. Update focused tests and current durable docs; prove no live references or
   disabled compatibility paths remain.
4. Run canonical verification, direct call-path proof, required coverage audit,
   ReviewGPT/CI for the PR lane, and the parent final review.
5. Close the plan with a scoped commit, push the branch, and open the PR.

## Verification

- Focused hosted Web verification passed: 9 files and 179 tests, followed by
  the prepared Web typecheck.
- The final truthful owner lane passed with
  `MURPH_WORKSPACE_ARTIFACT_LOCK_HELD=1 pnpm test:diff apps/web packages/contracts`
  after building the fresh-worktree `@murphai/assistant-runtime` prerequisite.
  It covered affected typechecks and package tests, hosted Web lint/dev
  smoke/production build plus 6,000 passing tests, and Cloudflare verification
  with 1,844 passing tests. The explicit lock marker avoids the verifier
  wrapper holding a lock across CLI tests that intentionally scrub inherited
  environment state.
- `git diff --check` passed. A tracked stale-reference scan excluding immutable
  completed plans and this active plan found no current source, test, config,
  or durable-doc reference to the four retired flags or their deleted helper,
  result-mode, and payload-mode names.
- Read-only production deployment status showed the Cloudflare consumer fleet
  at 100% on the compatible base revision before producers become
  unconditional.
- The stale production-only `HOSTED_MEMBER_RESET_ADMIN_ENABLED` Vercel entry
  was removed after proving the repository has no reader. The remaining
  personality rollout entry stays until the new Web build deploys because the
  preceding Web build still reads it.

## Decisions and outcomes

- Deleted the four rollout gates instead of replacing them with constants.
  Approval wakes, Assistant Ask production, group-join confirmation, and sparse
  causal personality writes now follow their current path automatically.
- Deleted legacy signal/manual-confirmation, feature-disabled, disabled-result,
  complete-snapshot producer, hidden-settings, rollout error, mock, and test
  branches that existed only for a gate-off state.
- Retained group-join materialization and bounded draining because they recover
  live crypto/private-route deferrals, not rollout state.
- Retained the runtime compatibility reader for already-imported tokenless
  preference items and the documented approval/runtime rollback floors because
  persisted work may still depend on them.

## Completion audits

- `frontend-review`: no findings. Existing components, layout, ordering, and
  expired-approval recovery remain intact. No fresh authenticated desktop/mobile
  screenshots were available, so pixel-level browser rendering remains a
  reported gap rather than an inferred pass.
- Claude Code UI double-check: Fable reported explicit usage-credit exhaustion;
  the completed Codex `frontend-review` is the required substitute.
- `coverage-write`: no edits and no missing stable-boundary proof. Existing
  transaction, service, API, and UI tests cover rollback, idempotency, causal
  ordering, authorization/privacy, retries, and durable wake behavior.
- Cross-cutting gate: the pushed PR uses ReviewGPT rather than local
  `deep-review`; PR CI, ReviewGPT, and latest-base merge proof remain external
  merge-readiness gates after this scoped commit.
Completed: 2026-07-21
